import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AcceptQuoteSchema,
  EventRequestSchema,
  PageQuerySchema,
  ReasonSchema,
  type AcceptQuoteInput,
  type EventRequestInput,
  type ReasonInput,
} from '@utsavora/validation';
import { CurrentActor, Roles, type Actor } from '../auth/actor';
import { ZodBody, ZodPipe } from '../common/zod';
import { WriteThrottle } from '../common/throttle';
import { QuotesService } from './quotes.service';

@ApiTags('event-requests')
@Roles('CUSTOMER')
@Controller('requests')
export class RequestsController {
  constructor(private readonly quotes: QuotesService) {}

  @WriteThrottle()
  @Post()
  @ZodBody(EventRequestSchema)
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(EventRequestSchema)) body: EventRequestInput) {
    return this.quotes.createRequest(actor, body);
  }

  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(PageQuerySchema)) q: { page: number; pageSize: number }) {
    return this.quotes.listRequests(actor, q.page, q.pageSize);
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.requestDetail(actor, id);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  @ZodBody(ReasonSchema)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: ReasonInput) {
    return this.quotes.cancelRequest(actor, id, body);
  }

  @HttpCode(200)
  @Post(':id/quotes/:quoteId/accept')
  @ZodBody(AcceptQuoteSchema)
  accept(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body(new ZodPipe(AcceptQuoteSchema)) body: AcceptQuoteInput,
  ) {
    return this.quotes.acceptQuote(actor, id, quoteId, body);
  }

  @HttpCode(200)
  @Post(':id/quotes/:quoteId/reject')
  @ZodBody(ReasonSchema)
  reject(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Body(new ZodPipe(ReasonSchema)) body: ReasonInput,
  ) {
    return this.quotes.rejectQuote(actor, id, quoteId, body);
  }
}
