import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { WorkerModule } from '../src/worker.module';
import { JobRunner } from '../src/common/jobs/job-runner';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg } from './helpers/users';

describe('JobRunner', () => {
  let runner: JobRunner;
  let close: () => Promise<void>;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await mod.init();
    runner = mod.get(JobRunner);
    close = () => mod.close();
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('runs per active org, isolates failures and records job_run rows', async () => {
    const a = await seedOrg('A');
    const b = await seedOrg('B');
    const s = await seedOrg('S');
    const m = await migratorClient();
    await m.query(`update organization set status='suspended' where id=$1`, [s.id]);
    const seen: string[] = [];
    const r = await runner.forEachActiveOrg('test.job', async (org) => {
      seen.push(org.id);
      if (org.id === a.id) throw new Error('boom');
    });
    expect(r).toEqual({ ok: 1, failed: 1 });
    expect(seen.sort()).toEqual([a.id, b.id].sort());
    const { rows } = await m.query(`select org_id, ok, error from job_run where name='test.job' order by ok`);
    await m.end();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ org_id: a.id, ok: false, error: 'boom' }),
        expect.objectContaining({ org_id: b.id, ok: true }),
      ]),
    );
  });
});
