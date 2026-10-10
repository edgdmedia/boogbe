import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../common/db/prisma.service';
import { Public } from '../../common/auth/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @Public()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, db: true };
  }
}
