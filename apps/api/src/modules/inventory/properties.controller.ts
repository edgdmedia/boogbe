import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { PropertyInput, SetPropertyOwnerInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { PropertiesService } from './properties.service';

class PropertyDto extends createZodDto(PropertyInput) {}
class PropertyPatchDto extends createZodDto(PropertyInput.partial()) {}
class OwnerDto extends createZodDto(SetPropertyOwnerInput) {}

@Controller('properties')
export class PropertiesController {
  constructor(private readonly svc: PropertiesService) {}

  @Get()
  @Permission('inventory.read')
  async list(@Ctx() c: RequestCtx, @Query('includeArchived') a?: string) {
    return { items: await this.svc.list(requireOrg(c), a === 'true') };
  }

  @Get(':id')
  @Permission('inventory.read')
  get(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.get(requireOrg(c), id);
  }

  @Post()
  @Permission('inventory.write')
  create(@Ctx() c: RequestCtx, @Body() b: PropertyDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Patch(':id')
  @Permission('inventory.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: PropertyPatchDto) {
    return this.svc.update(requireOrg(c), id, b);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Permission('inventory.write')
  archive(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.setActive(requireOrg(c), id, false);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @Permission('inventory.write')
  unarchive(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.setActive(requireOrg(c), id, true);
  }

  @Post(':id/owner')
  @HttpCode(200)
  @Permission('owners.write')
  owner(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: OwnerDto) {
    return this.svc.setDefaultOwner(requireOrg(c), id, b);
  }
}
