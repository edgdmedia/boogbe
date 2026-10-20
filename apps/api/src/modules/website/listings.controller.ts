import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ListingInput, ListingUnitsInput, ListingUpdate } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { ListingsService } from './listings.service';

class ListingDto extends createZodDto(ListingInput) {}
class ListingPatchDto extends createZodDto(ListingUpdate) {}
class ListingUnitsDto extends createZodDto(ListingUnitsInput) {}
class OrderDto extends createZodDto(z.object({ ids: z.array(z.string()).min(1).max(100) })) {}

@Controller('listings')
@Permission('inventory.read')
export class ListingsController {
  constructor(private readonly svc: ListingsService) {}

  @Get()
  async list(@Ctx() c: RequestCtx) {
    return { items: await this.svc.list(requireOrg(c)) };
  }

  @Get(':id')
  get(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.get(requireOrg(c), id);
  }

  @Post()
  @Permission('inventory.write')
  create(@Ctx() c: RequestCtx, @Body() b: ListingDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Put('order')
  @HttpCode(200)
  @Permission('inventory.write')
  order(@Ctx() c: RequestCtx, @Body() b: OrderDto) {
    return this.svc.reorder(requireOrg(c), b.ids);
  }

  @Patch(':id')
  @Permission('inventory.write')
  patch(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: ListingPatchDto) {
    return this.svc.patch(requireOrg(c), id, b);
  }

  @Put(':id/units')
  @HttpCode(200)
  @Permission('inventory.write')
  units(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: ListingUnitsDto) {
    return this.svc.setUnits(requireOrg(c), id, b);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Permission('inventory.write')
  publish(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.setPublished(requireOrg(c), id, true);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @Permission('inventory.write')
  unpublish(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.setPublished(requireOrg(c), id, false);
  }

  @Delete(':id')
  @Permission('inventory.write')
  remove(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.remove(requireOrg(c), id);
  }
}
