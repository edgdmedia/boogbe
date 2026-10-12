import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IcalFeedInput } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { FeedsService } from './feeds.service';

class FeedDto extends createZodDto(IcalFeedInput) {}
class FeedPatch extends createZodDto(
  z.object({ label: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional() }).strict(),
) {}

@Controller()
export class FeedsController {
  constructor(private readonly svc: FeedsService) {}

  @Get('units/:id/ical')
  @Permission('ical.read')
  forUnit(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.forUnit(requireOrg(c), id);
  }

  @Post('ical/feeds')
  @Permission('ical.write')
  create(@Ctx() c: RequestCtx, @Body() b: FeedDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Patch('ical/feeds/:id')
  @Permission('ical.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: FeedPatch) {
    return this.svc.update(requireOrg(c), id, b);
  }

  @Delete('ical/feeds/:id')
  @Permission('ical.write')
  remove(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.remove(requireOrg(c), id);
  }

  @Post('ical/feeds/:id/sync')
  @HttpCode(200)
  @Permission('ical.write')
  sync(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.syncNow(requireOrg(c), id);
  }
}
