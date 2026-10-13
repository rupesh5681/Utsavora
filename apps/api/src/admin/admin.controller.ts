import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CommissionSettingsSchema,
  ModerationDecisionSchema,
  OrderListQuerySchema,
  PageQuerySchema,
  RecordPaymentSchema,
  z,
  type CommissionSettingsInput,
  type ModerationDecisionInput,
  type OrderListQuery,
  type RecordPaymentInput,
} from '@utsavora/validation';
import { CurrentActor, RequirePermissions, Roles, type Actor } from '../auth/actor';
import { ZodBody, ZodPipe } from '../common/zod';
import { OrdersService } from '../orders/orders.service';
import { QuotesService } from '../quotes/quotes.service';
import { OutboxService } from '../common/outbox.service';
import { AuditService } from '../common/audit.service';
import { AdminService, ORDER_CSV_COLUMNS, toCsv } from './admin.service';
import { todayIST } from '../common/time';

const StatusPage = PageQuerySchema.extend({ status: z.string().max(40).optional() });
type StatusPage = z.infer<typeof StatusPage>;
const AuditQuery = PageQuerySchema.extend({ entityType: z.string().max(40).optional(), entityId: z.string().max(64).optional() });
const ExportQuery = OrderListQuerySchema.omit({ page: true, pageSize: true });
const RetrySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly orders: OrdersService,
    private readonly quotes: QuotesService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  // Vendors
  @RequirePermissions('VENDORS_REVIEW')
  @Get('vendors')
  vendors(@Query(new ZodPipe(StatusPage)) q: StatusPage) {
    return this.admin.vendors(q.status, q.page, q.pageSize);
  }

  @RequirePermissions('VENDORS_REVIEW')
  @Get('vendors/:id')
  vendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.vendor(id);
  }

  @RequirePermissions('VENDORS_REVIEW')
  @HttpCode(200)
  @Post('vendors/:id/decision')
  @ZodBody(ModerationDecisionSchema)
  decideVendor(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ModerationDecisionSchema)) body: ModerationDecisionInput) {
    return this.admin.decideVendor(actor, id, body);
  }

  // Listings / menus / packages
  @RequirePermissions('LISTINGS_MODERATE')
  @Get('listings')
  listings(@Query(new ZodPipe(StatusPage)) q: StatusPage) {
    return this.admin.listings(q.status, q.page, q.pageSize);
  }

  @RequirePermissions('LISTINGS_MODERATE')
  @HttpCode(200)
  @Post('listings/:id/decision')
  @ZodBody(ModerationDecisionSchema)
  decideListing(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ModerationDecisionSchema)) body: ModerationDecisionInput) {
    return this.admin.decideListing(actor, id, body);
  }

  // Event requests
  @RequirePermissions('ORDERS_MANAGE')
  @Get('requests')
  requests(@Query(new ZodPipe(StatusPage)) q: StatusPage) {
    return this.quotes.adminRequests(q.status, q.page, q.pageSize);
  }

  @RequirePermissions('ORDERS_MANAGE')
  @Get('requests/:id')
  request(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.requestDetail(actor, id);
  }

  // Booking queue
  @RequirePermissions('ORDERS_MANAGE')
  @Get('orders')
  orderQueue(@CurrentActor() actor: Actor, @Query(new ZodPipe(OrderListQuerySchema)) q: OrderListQuery) {
    return this.orders.list(actor, q);
  }

  @RequirePermissions('ORDERS_MANAGE')
  @Get('orders/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportOrders(@CurrentActor() actor: Actor, @Query(new ZodPipe(ExportQuery)) q: z.infer<typeof ExportQuery>) {
    const rows = await this.orders.exportRows(actor, q);
    await this.audit.record(actor, { action: 'orders.exported', entityType: 'order', entityId: 'export', metadata: { filters: q, rows: rows.length } });
    return new StreamableFile(Buffer.from(toCsv(rows as never, ORDER_CSV_COLUMNS), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="utsavora-bookings-${todayIST()}.csv"`,
    });
  }

  @RequirePermissions('PAYMENTS_RECORD')
  @HttpCode(200)
  @Post('orders/:id/payments')
  @ZodBody(RecordPaymentSchema)
  recordPayment(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(RecordPaymentSchema)) body: RecordPaymentInput) {
    return this.orders.recordPayment(actor, id, body);
  }

  // Settings
  @RequirePermissions('SETTINGS_MANAGE')
  @Get('settings/commission')
  commission() {
    return this.admin.commission();
  }

  @RequirePermissions('SETTINGS_MANAGE')
  @Put('settings/commission')
  @ZodBody(CommissionSettingsSchema)
  updateCommission(@CurrentActor() actor: Actor, @Body(new ZodPipe(CommissionSettingsSchema)) body: CommissionSettingsInput) {
    return this.admin.updateCommission(actor, body);
  }

  // Operations
  @RequirePermissions('AUDIT_VIEW')
  @Get('audit-logs')
  auditLogs(@Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.admin.auditLogs(q);
  }

  @RequirePermissions('AUDIT_VIEW')
  @Get('notification-failures')
  failures() {
    return this.outbox.failures();
  }

  @RequirePermissions('SETTINGS_MANAGE')
  @HttpCode(200)
  @Post('notification-failures/retry')
  @ZodBody(RetrySchema)
  async retry(@CurrentActor() actor: Actor, @Body(new ZodPipe(RetrySchema)) body: z.infer<typeof RetrySchema>) {
    await this.outbox.retry(body.ids);
    await this.audit.record(actor, { action: 'outbox.retry', entityType: 'outbox', entityId: 'batch', metadata: { ids: body.ids } });
    return { ok: true };
  }
}
