import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CreateExportInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { ExportsService } from './exports.service';

class CreateExportDto extends createZodDto(CreateExportInput) {}

@Controller('ical/exports')
export class ExportsController {
  constructor(private readonly svc: ExportsService) {}

  @Post()
  @Permission('ical.write')
  create(@Ctx() c: RequestCtx, @Body() b: CreateExportDto) {
    return this.svc.create(requireOrg(c), b.unitId, b.channel);
  }

  @Post(':id/rotate')
  @HttpCode(200)
  @Permission('ical.write')
  rotate(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.rotate(requireOrg(c), id);
  }
}
