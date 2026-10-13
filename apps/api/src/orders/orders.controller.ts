import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrderActionSchema, OrderListQuerySchema, type OrderActionInput, type OrderListQuery } from '@utsavora/validation';
import { CurrentActor, Roles, type Actor } from '../auth/actor';
import { ZodBody, ZodPipe } from '../common/zod';
import { OrdersService } from './orders.service';

/** Shared by all three apps; results are scoped to the signed-in customer, vendor or admin. */
@ApiTags('orders')
@Roles('CUSTOMER', 'VENDOR', 'ADMIN')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query(new ZodPipe(OrderListQuerySchema)) q: OrderListQuery) {
    return this.orders.list(actor, q);
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(actor, id);
  }

  @HttpCode(200)
  @Post(':id/actions')
  @ZodBody(OrderActionSchema)
  act(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(OrderActionSchema)) body: OrderActionInput) {
    return this.orders.act(actor, id, body);
  }
}
