import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { GuestInput, GuestListQuery, GuestMatchQuery } from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { GuestsService } from './guests.service';

class GuestDto extends createZodDto(GuestInput) {}
class GuestPatchDto extends createZodDto(GuestInput.partial()) {}
class ListQ extends createZodDto(GuestListQuery) {}
class MatchQ extends createZodDto(GuestMatchQuery) {}

@Controller('guests')
export class GuestsController {
  constructor(private readonly svc: GuestsService) {}

  @Get()
  @Permission('guests.read')
  list(@Ctx() c: RequestCtx, @Query() q: ListQ) {
    return this.svc.list(requireOrg(c), q);
  }

  // Declared before ':id' so "match" isn't taken for an id.
  @Get('match')
  @Permission('guests.read')
  match(@Ctx() c: RequestCtx, @Query() q: MatchQ) {
    return this.svc.match(requireOrg(c), q);
  }

  @Get(':id')
  @Permission('guests.read')
  get(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.get(requireOrg(c), id);
  }

  @Post()
  @Permission('guests.write')
  create(@Ctx() c: RequestCtx, @Body() b: GuestDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Patch(':id')
  @Permission('guests.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: GuestPatchDto) {
    return this.svc.update(requireOrg(c), id, b);
  }
}
