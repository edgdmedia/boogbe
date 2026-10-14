import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { newId } from '../db/ids';

@Injectable()
export class JobRunner {
  private readonly log = new Logger('Jobs');
  constructor(private readonly prisma: PrismaService) {}

  async forEachActiveOrg(name: string, fn: (org: { id: string; timezone: string }) => Promise<void>) {
    const orgs = await this.prisma.organization.findMany({
      where: { status: 'active' },
      select: { id: true, timezone: true },
    });
    let ok = 0;
    let failed = 0;
    for (const org of orgs) {
      const id = newId();
      await this.prisma.jobRun.create({ data: { id, name, orgId: org.id } });
      try {
        await fn(org);
        ok++;
        await this.prisma.jobRun.update({ where: { id }, data: { ok: true, finishedAt: new Date() } });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        this.log.error(`${name} org=${org.id}: ${msg}`);
        await this.prisma.jobRun.update({ where: { id }, data: { ok: false, error: msg.slice(0, 2000), finishedAt: new Date() } });
      }
    }
    return { ok, failed };
  }

  async once(name: string, fn: () => Promise<void>) {
    const id = newId();
    await this.prisma.jobRun.create({ data: { id, name } });
    try {
      await fn();
      await this.prisma.jobRun.update({ where: { id }, data: { ok: true, finishedAt: new Date() } });
    } catch (e) {
      await this.prisma.jobRun.update({ where: { id }, data: { ok: false, error: String(e).slice(0, 2000), finishedAt: new Date() } });
      throw e;
    }
  }
}
