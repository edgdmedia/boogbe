import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { AuditQuery } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { AuditQueryService } from './audit-query.service';

class Q extends createZodDto(AuditQuery) {}

@Controller('audit')
export class AuditController {
  constructor(private readonly svc: AuditQueryService) {}

  @Get()
  @Permission('audit.read')
  list(@Ctx() c: RequestCtx, @Query() q: Q) {
    return this.svc.list(requireOrg(c), q);
  }
}
