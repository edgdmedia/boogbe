import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  BookingListQuery,
  CancelBookingInput,
  CreateBookingInput,
  QuoteRequest,
  TransitionInput,
  UpdateBookingInput,
} from '@boogbe/shared';
import { Ctx, Permission } from '../../common/auth/decorators';
import { requireOrg, type RequestCtx } from '../../common/auth/request-ctx';
import { GuestsService } from '../guests/guests.service';
import { BookingsService } from './bookings.service';

class QuoteDto extends createZodDto(QuoteRequest) {}
class CreateDto extends createZodDto(CreateBookingInput) {}
class ListQ extends createZodDto(BookingListQuery) {}
class UpdateDto extends createZodDto(UpdateBookingInput) {}
class TransitionDto extends createZodDto(TransitionInput) {}
class CancelDto extends createZodDto(CancelBookingInput) {}

@Controller()
export class BookingsController {
  constructor(
    private readonly svc: BookingsService,
    private readonly guests: GuestsService,
  ) {}

  @Post('bookings/quote')
  @HttpCode(200)
  @Permission('bookings.read')
  quote(@Ctx() c: RequestCtx, @Body() b: QuoteDto) {
    return this.svc.quote(requireOrg(c), b);
  }

  @Post('bookings')
  @Permission('bookings.write')
  create(@Ctx() c: RequestCtx, @Body() b: CreateDto) {
    return this.svc.create(requireOrg(c), b);
  }

  @Get('bookings')
  @Permission('bookings.read')
  list(@Ctx() c: RequestCtx, @Query() q: ListQ) {
    return this.svc.list(requireOrg(c), q);
  }

  @Get('bookings/:id')
  @Permission('bookings.read')
  get(@Ctx() c: RequestCtx, @Param('id') id: string) {
    return this.svc.get(requireOrg(c), id);
  }

  @Get('guests/:id/bookings')
  @Permission('bookings.read')
  async forGuest(@Ctx() c: RequestCtx, @Param('id') id: string) {
    const ctx = requireOrg(c);
    await this.guests.get(ctx, id); // 404 for unknown or other-operator guests, not an empty list
    return { items: (await this.svc.list(ctx, { guestId: id, limit: 100 })).items };
  }

  @Patch('bookings/:id')
  @Permission('bookings.write')
  update(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: UpdateDto) {
    return this.svc.update(requireOrg(c), id, b);
  }

  @Post('bookings/:id/transition')
  @HttpCode(200)
  @Permission('bookings.write')
  transition(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: TransitionDto) {
    return this.svc.transition(requireOrg(c), id, b);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Permission('bookings.write')
  cancel(@Ctx() c: RequestCtx, @Param('id') id: string, @Body() b: CancelDto) {
    return this.svc.cancel(requireOrg(c), id, b);
  }
}
