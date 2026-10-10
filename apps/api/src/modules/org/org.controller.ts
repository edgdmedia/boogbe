import { Body, Controller, Get, Patch } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { UpdateOrgSettingsInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { OrgService } from './org.service';

class UpdateDto extends createZodDto(UpdateOrgSettingsInput) {}

@Controller('org')
export class OrgController {
  constructor(private readonly svc: OrgService) {}

  @Get('settings')
  @Permission('org.settings.read')
  get(@Ctx() c: RequestCtx) {
    return this.svc.get(requireOrg(c));
  }

  @Patch('settings')
  @Permission('org.settings.write')
  update(@Ctx() c: RequestCtx, @Body() b: UpdateDto) {
    return this.svc.update(requireOrg(c), b);
  }
}
