import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { OrgDb } from '../src/common/db/org-db.service';
import { PrismaService } from '../src/common/db/prisma.service';

describe('OrgDb', () => {
  let t: TestApp;
  let db: OrgDb;
  let a: { id: string }, b: { id: string };
  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(OrgDb);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    a = await seedOrg('A');
    b = await seedOrg('B');
    const m = await migratorClient();
    await m.query(
      `insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'AA','AA','AA',now()),($2,'BB','BB','BB',now())`,
      [a.id, b.id],
    );
    await m.end();
  });

  it('injects orgId into reads', async () => {
    const rows = await db.run(a.id, (tx) => tx.orgSettings.findMany());
    expect(rows.map((r) => r.orgId)).toEqual([a.id]);
  });

  it("update by id cannot touch another org's row", async () => {
    await expect(
      db.run(a.id, (tx) => tx.orgSettings.update({ where: { orgId: b.id }, data: { receiptPrefix: 'HACK' } })),
    ).rejects.toThrow();
    const m = await migratorClient();
    const { rows } = await m.query(`select receipt_prefix from org_settings where org_id=$1`, [b.id]);
    await m.end();
    expect(rows[0].receipt_prefix).toBe('BB');
  });

  it('injects orgId into creates', async () => {
    await db.run(a.id, (tx) => tx.orgCounter.create({ data: { name: 'booking', value: 0n } as never }));
    const m = await migratorClient();
    const { rows } = await m.query(`select org_id from org_counter`);
    await m.end();
    expect(rows).toEqual([{ org_id: a.id }]);
  });

  it('nextNumber is gapless and per-org under concurrency', async () => {
    const nums = await Promise.all(
      Array.from({ length: 10 }, () => db.run(a.id, (tx) => db.nextNumber(tx, 'receipt'))),
    );
    expect([...nums].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await db.run(b.id, (tx) => db.nextNumber(tx, 'receipt'))).toBe(1);
  });

  it('refuses tenant access outside run()', async () => {
    const prisma = t.app.get(PrismaService);
    const scoped = db.unsafeScopedClientForTests();
    await expect(scoped.orgSettings.findMany()).rejects.toThrow('outside OrgDb.run');
    expect(prisma).toBeDefined();
  });

  it('refuses an empty orgId', async () => {
    await expect(db.run('', async () => 1)).rejects.toThrow('orgId required');
  });
});
