import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';
import { OrgDb } from '../src/common/db/org-db.service';
import { newId } from '../src/common/db/ids';

describe('inventory schema constraints', () => {
  let t: TestApp;
  let db: OrgDb;
  let org: { id: string };
  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(OrgDb);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await truncateAll();
    org = await seedOrg();
  });

  async function unit() {
    return db.run(org.id, async (tx) => {
      const p = await tx.property.create({ data: { id: newId(), name: 'Rock', address: 'Lekki' } as never });
      return tx.unit.create({
        data: { id: newId(), propertyId: p.id, name: 'Kairo', bedrooms: 2, maxGuests: 4, nightlyRateKobo: 20_000_000n } as never,
      });
    });
  }

  it('rejects overlapping manual blocks but allows adjacent ones', async () => {
    const u = await unit();
    const mk = (s: string, e: string) =>
      db.run(org.id, (tx) =>
        tx.block.create({
          data: { id: newId(), unitId: u.id, start: new Date(s), end: new Date(e), source: 'manual', reason: 'maintenance' } as never,
        }),
      );
    await mk('2026-10-10', '2026-10-12');
    await mk('2026-10-12', '2026-10-13');
    await expect(mk('2026-10-11', '2026-10-14')).rejects.toThrow(/block_manual_no_overlap|23P01|exclusion/);
  });

  it('rejects overlapping ownership periods', async () => {
    const u = await unit();
    const mk = (f: string, to: string | null) =>
      db.run(org.id, (tx) =>
        tx.unitOwnership.create({
          data: { id: newId(), unitId: u.id, ownerId: null, effectiveFrom: new Date(f), effectiveTo: to ? new Date(to) : null } as never,
        }),
      );
    await mk('2026-01-01', '2026-06-01');
    await mk('2026-06-01', null);
    await expect(mk('2026-07-01', null)).rejects.toThrow();
  });

  it('rejects a zero rate', async () => {
    await expect(
      db.run(org.id, async (tx) => {
        const p = await tx.property.create({ data: { id: newId(), name: 'P', address: 'A' } as never });
        return tx.unit.create({
          data: { id: newId(), propertyId: p.id, name: 'U', bedrooms: 1, maxGuests: 2, nightlyRateKobo: 0n } as never,
        });
      }),
    ).rejects.toThrow(/unit_rate_chk/);
  });
});
