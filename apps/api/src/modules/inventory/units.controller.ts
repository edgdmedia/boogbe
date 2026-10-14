import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDateSchema, SetUnitOwnerInput, UnitInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { UnitsService } from './units.service';

class UnitDto extends createZodDto(UnitInput) {}
class UnitPatchDto extends createZodDto(UnitInput.partial()) {}
class ListQuery extends createZodDto(
  z.object({
    propertyId: z.string().optional(),
    includeArchived: z.enum(['true', 'false']).optional(),
    asOf: IsoDateSchema.optional(),
  }),
) {}

@Controller('units')
export class UnitsController {
  constructor(private readonly svc: UnitsService) {}

  @Get()
  @Permission('inventory.read')
  async list(@Ctx() c: RequestCtx, @Query() q: ListQuery) {
    return {
      items: await this.svc.list(requireOrg(c), {
        propertyId: q.propertyId,
        includeArchived: q.includeArchived === 'true',
        asOf: q.asOf,
      }),
    };
  }

  @Get(':id')
  @Permission('inventory.read')
  get(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.get(requireOrg(c), id);
  }

  @Post()
  @Permission('inventory.write')
  create(@Ctx() c: RequestCtx, @Body() b: UnitDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Patch(':id')
  @Permission('inventory.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: UnitPatchDto) {
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
  // A discriminated union can't be a DTO class, so the schema validates the body directly.
  owner(
    @Ctx() c: RequestCtx,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetUnitOwnerInput)) b: SetUnitOwnerInput,
  ) {
    return this.svc.setOwner(requireOrg(c), id, b);
  }

  @Get(':id/ownership')
  @Permission('owners.read')
  history(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.ownershipHistory(requireOrg(c), id);
  }
}
