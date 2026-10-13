/**
 * First objective, end to end against a real PostgreSQL database:
 * customer request → approved vendor quotes (and revises) → customer accepts → durable, tracked order.
 */
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { admin, bootApp, createRequest, futureDate, newCustomer, newVendor, refData, revisionBody, vendorQuoteFor, type Ref } from './helpers';
import type { Db } from '../src/db/client';
import { notifications, quoteRevisions, orders } from '../src/db/schema';
import type { OutboxService } from '../src/common/outbox.service';

let app: INestApplication;
let db: Db;
let outbox: OutboxService;
let ref: Ref;

beforeAll(async () => {
  ({ app, db, outbox } = await bootApp());
  ref = await refData(app);
});
afterAll(() => app.close());

describe('request → quote → accept → order', () => {
  it('runs the full slice with revisions, snapshot, commission, tracking and payments', async () => {
    const area = 'Knowledge Park';
    const v1 = await newVendor(app, ref, { areas: [area], name: 'Swaad Caterers' });
    const v2 = await newVendor(app, ref, { areas: [area], name: 'Rasoi Express' });
    const customer = await newCustomer(app, 'Meera Iyer');

    // Customer submits an event request; both approved vendors in the area are invited.
    const created = await createRequest(customer, ref, { serviceAreaId: ref.areas[area] });
    expect(created.status).toBe(201);
    expect(created.body.data.matchedVendors).toBe(2);
    expect(created.body.data.reference).toMatch(/^EVR-[A-Z2-9]{8}$/);
    const requestId = created.body.data.id;

    // Vendors see it in their inbox without the customer's contact details.
    const q1 = await vendorQuoteFor(v1, requestId);
    const q2 = await vendorQuoteFor(v2, requestId);
    let detail = await v1.get(`/vendor/quotes/${q1}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.request.guestCount).toBe(100);
    expect(JSON.stringify(detail.body.data)).not.toContain('9876543210');
    expect(detail.body.data.customerFirstName).toBe('Meera');

    await v1.post(`/vendor/quotes/${q1}/review`).expect(200);

    // Vendor 1 quotes; server computes totals and ignores client-sent totals.
    const r1 = await v1.post(`/vendor/quotes/${q1}/revisions`, { ...revisionBody(), totalPaise: 1, advancePaise: 1 });
    expect(r1.status).toBe(201);
    const rev1 = r1.body.data.revisions[0];
    expect(rev1).toMatchObject({ revisionNumber: 1, subtotalPaise: 6300000, taxPaise: 300000, totalPaise: 6450000, advancePaise: 1935000 });
    expect(r1.body.data.status).toBe('QUOTED');

    // Vendor 2 quotes higher.
    await v2.post(`/vendor/quotes/${q2}/revisions`, revisionBody({ items: [{ description: 'Deluxe buffet', quantity: 100, unitPricePaise: 75000 }], discountPaise: 0 })).expect(201);

    // Customer compares quotes (cheapest first).
    let cmp = await customer.get(`/requests/${requestId}`);
    expect(cmp.status).toBe(200);
    expect(cmp.body.data.quotes.map((q: { vendor: { businessName: string } }) => q.vendor.businessName)).toEqual(['Swaad Caterers', 'Rasoi Express']);

    // Vendor 1 revises (discount up). Accepting the stale revision must fail.
    const r2 = await v1.post(`/vendor/quotes/${q1}/revisions`, revisionBody({ discountPaise: 500000 }));
    expect(r2.status).toBe(201);
    expect(r2.body.data.status).toBe('REVISED');
    const rev2 = r2.body.data.revisions[0];
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.totalPaise).toBe(6240000); // (6300000-500000)=5800000 +5% 290000 +150000

    const stale = await customer.post(`/requests/${requestId}/quotes/${q1}/accept`, { revisionId: rev1.id });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('QUOTE_REVISED');

    // Accept the latest revision → order.
    const accepted = await customer.post(`/requests/${requestId}/quotes/${q1}/accept`, { revisionId: rev2.id });
    expect(accepted.status).toBe(200);
    const order = accepted.body.data;
    expect(order.orderNumber).toMatch(/^UTS-\d{6}-[A-Z2-9]{5}$/);
    expect(order.status).toBe('PENDING_CONFIRMATION');
    expect(order.totalPaise).toBe(6240000);
    expect(order.advancePaise).toBe(1872000);
    expect(order.snapshot.quote.revisionNumber).toBe(2);
    expect(order.snapshot.quote.items).toHaveLength(2);
    expect(order.snapshot.event.services).toEqual(['Catering']);
    expect(order.commissionPaise).toBeUndefined(); // customers don't see the platform split
    expect(order.actions).toEqual(['customer_cancel']);

    // Commission: catering rule 8% of taxable 5,800,000 = 464,000.
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.commissionBps).toBe(800);
    expect(row.commissionPaise).toBe(464000);
    expect(row.vendorPayablePaise).toBe(6240000 - 464000);
    expect(row.isDemo).toBe(false);

    // Request and quote states settled; second accept and other quote are blocked.
    cmp = await customer.get(`/requests/${requestId}`);
    expect(cmp.body.data.status).toBe('ACCEPTED');
    expect(cmp.body.data.order.id).toBe(order.id);
    const states = Object.fromEntries(cmp.body.data.quotes.map((q: { id: string; status: string }) => [q.id, q.status]));
    expect(states).toEqual({ [q1]: 'ACCEPTED', [q2]: 'NOT_SELECTED' });
    const again = await customer.post(`/requests/${requestId}/quotes/${q2}/accept`, { revisionId: cmp.body.data.quotes[1].currentRevisionId });
    expect(again.status).toBe(409);
    expect((await v2.post(`/vendor/quotes/${q2}/revisions`, revisionBody())).status).toBe(409);

    // Vendor sees the order with customer contact now; confirms it.
    detail = await v1.get(`/orders/${order.id}`);
    expect(detail.body.data.customer.phone).toBe('9876543210');
    expect(detail.body.data.vendorPayablePaise).toBe(5776000);
    const confirmed = await v1.post(`/orders/${order.id}/actions`, { action: 'vendor_confirm' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('PAYMENT_PENDING');

    // Vendors and customers cannot mark an order paid; admin records verified payments.
    expect((await v1.post(`/admin/orders/${order.id}/payments`, {})).status).toBe(403);
    const a = await admin(app);
    let pay = await a.post(`/admin/orders/${order.id}/payments`, { amountPaise: 1000000, method: 'UPI', reference: 'UPI-REF-1', receivedOn: futureDate(0) });
    expect(pay.status).toBe(200);
    expect(pay.body.data.status).toBe('PAYMENT_PENDING'); // partial advance
    const dup = await a.post(`/admin/orders/${order.id}/payments`, { amountPaise: 1000, method: 'UPI', reference: 'upi-ref-1', receivedOn: futureDate(0) });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_PAYMENT');
    const over = await a.post(`/admin/orders/${order.id}/payments`, { amountPaise: 99999999, method: 'UPI', reference: 'UPI-REF-X', receivedOn: futureDate(0) });
    expect(over.body.error.code).toBe('OVERPAYMENT');
    pay = await a.post(`/admin/orders/${order.id}/payments`, { amountPaise: 872000, method: 'BANK_TRANSFER', reference: 'NEFT-778', receivedOn: futureDate(0) });
    expect(pay.body.data.status).toBe('CONFIRMED');
    expect(pay.body.data.paidPaise).toBe(1872000);

    // Customer can no longer cancel a confirmed booking themselves; it's too early to complete.
    const cancel = await customer.post(`/orders/${order.id}/actions`, { action: 'customer_cancel' });
    expect(cancel.status).toBe(409);
    const early = await v1.post(`/orders/${order.id}/actions`, { action: 'start' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('TOO_EARLY');

    // Tracking timeline as the customer sees it.
    const tracked = await customer.get(`/orders/${order.id}`);
    expect(tracked.body.data.timeline.map((e: { action: string }) => e.action)).toEqual([
      'quote_accepted',
      'vendor_confirm',
      'payment_recorded',
      'payment_recorded',
    ]);
    expect(tracked.body.data.payments).toHaveLength(2);
    expect(tracked.body.data.payments[0].reference).toBeUndefined();

    // Customer order history.
    const list = await customer.get('/orders');
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].vendorPayablePaise).toBeUndefined();

    // Outbox → notifications for both sides.
    expect(await outbox.dispatchPending(500)).toBeGreaterThan(0);
    const vendorNotes = await v1.get('/notifications');
    expect(vendorNotes.body.data.items.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(['quote.requested', 'order.created', 'payment.recorded']));
    const loserNotes = await v2.get('/notifications');
    expect(loserNotes.body.data.items.map((n: { type: string }) => n.type)).toContain('quote.not_selected');
    const customerNotes = await customer.get('/notifications');
    expect(customerNotes.body.data.unread).toBeGreaterThanOrEqual(3);
    const n = await db.select().from(notifications).where(eq(notifications.type, 'quote.submitted'));
    expect(n.length).toBeGreaterThanOrEqual(3);

    // Admin booking queue + CSV export.
    const queue = await a.get(`/admin/orders?q=${order.orderNumber}`);
    expect(queue.body.data[0].commissionPaise).toBe(464000);
    const csv = await a.get('/admin/orders/export.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Order number,Demo,Status');
    expect(csv.text).toContain(order.orderNumber);
    expect(csv.text).toContain('62400.00');

    // Audit trail for the accept.
    const audit = await a.get(`/admin/audit-logs?entityType=quote&entityId=${q1}`);
    expect(audit.body.data.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['quote.accepted', 'quote.revision_submitted']));
  });

  it('stores revisions immutably — the order keeps its snapshot even if data changes later', async () => {
    const area = 'Techzone';
    const v = await newVendor(app, ref, { areas: [area] });
    const c = await newCustomer(app);
    const req = (await createRequest(c, ref, { serviceAreaId: ref.areas[area] })).body.data.id;
    const q = await vendorQuoteFor(v, req);
    const rev = (await v.post(`/vendor/quotes/${q}/revisions`, revisionBody())).body.data.revisions[0];
    const order = (await c.post(`/requests/${req}/quotes/${q}/accept`, { revisionId: rev.id })).body.data;
    // Rename the vendor afterwards: the order snapshot must not change.
    await v.put('/vendor/me', {
      businessName: 'Renamed Caterers',
      description: 'Family-run caterers serving North Indian vegetarian and Mughlai food across Greater Noida since 2012.',
      phone: '9811122233',
      fssaiNumber: '10020051000999',
      categoryIds: [ref.categories.catering],
      serviceAreaIds: [ref.areas[area]],
    });
    const after = await c.get(`/orders/${order.id}`);
    expect(after.body.data.snapshot.vendor.businessName).toBe(v.businessName);
    expect(after.body.data.snapshot.quote.totalPaise).toBe(rev.totalPaise);
  });

  it('rejects tampered stored totals at acceptance', async () => {
    const area = 'Surajpur';
    const v = await newVendor(app, ref, { areas: [area] });
    const c = await newCustomer(app);
    const req = (await createRequest(c, ref, { serviceAreaId: ref.areas[area] })).body.data.id;
    const q = await vendorQuoteFor(v, req);
    const rev = (await v.post(`/vendor/quotes/${q}/revisions`, revisionBody())).body.data.revisions[0];
    await db.update(quoteRevisions).set({ totalPaise: 100, advancePaise: 30 }).where(eq(quoteRevisions.id, rev.id));
    const r = await c.post(`/requests/${req}/quotes/${q}/accept`, { revisionId: rev.id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PRICE_MISMATCH');
  });

  it('expires quotes past their validity and refuses to accept them', async () => {
    const area = 'Dadri';
    const v = await newVendor(app, ref, { areas: [area] });
    const c = await newCustomer(app);
    const req = (await createRequest(c, ref, { serviceAreaId: ref.areas[area] })).body.data.id;
    const q = await vendorQuoteFor(v, req);
    const rev = (await v.post(`/vendor/quotes/${q}/revisions`, revisionBody({ validUntil: futureDate(1) }))).body.data.revisions[0];
    await db.update(quoteRevisions).set({ validUntil: futureDate(-1) }).where(eq(quoteRevisions.id, rev.id));
    const r = await c.post(`/requests/${req}/quotes/${q}/accept`, { revisionId: rev.id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QUOTE_NOT_ACCEPTABLE');
    const d = await c.get(`/requests/${req}`);
    expect(d.body.data.quotes[0].status).toBe('EXPIRED');
  });

  it('validates quote validity window and line items', async () => {
    const area = 'Mu';
    const v = await newVendor(app, ref, { areas: [area] });
    const c = await newCustomer(app);
    const req = (await createRequest(c, ref, { serviceAreaId: ref.areas[area], eventDate: futureDate(5) })).body.data.id;
    const q = await vendorQuoteFor(v, req);
    let r = await v.post(`/vendor/quotes/${q}/revisions`, revisionBody({ validUntil: futureDate(6) }));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_VALIDITY');
    r = await v.post(`/vendor/quotes/${q}/revisions`, revisionBody({ items: [] }));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details[0].path).toBe('items');
    r = await v.post(`/vendor/quotes/${q}/revisions`, revisionBody({ discountPaise: 99999999, validUntil: futureDate(3) }));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_PRICING');
  });

  it('lets vendors decline and withdraw, and customers reject and cancel', async () => {
    const area = 'Chi';
    const v1 = await newVendor(app, ref, { areas: [area] });
    const v2 = await newVendor(app, ref, { areas: [area] });
    const c = await newCustomer(app);
    const req = (await createRequest(c, ref, { serviceAreaId: ref.areas[area] })).body.data.id;
    const q1 = await vendorQuoteFor(v1, req);
    const q2 = await vendorQuoteFor(v2, req);
    expect((await v1.post(`/vendor/quotes/${q1}/decline`, { reason: 'Fully booked that week' })).body.data.status).toBe('DECLINED');
    expect((await v1.post(`/vendor/quotes/${q1}/revisions`, revisionBody())).status).toBe(409);
    await v2.post(`/vendor/quotes/${q2}/revisions`, revisionBody()).expect(201);
    expect((await v2.post(`/vendor/quotes/${q2}/withdraw`, {})).body.data.status).toBe('WITHDRAWN');

    const req2 = (await createRequest(c, ref, { serviceAreaId: ref.areas[area] })).body.data.id;
    const q3 = await vendorQuoteFor(v1, req2);
    await v1.post(`/vendor/quotes/${q3}/revisions`, revisionBody()).expect(201);
    const rej = await c.post(`/requests/${req2}/quotes/${q3}/reject`, { reason: 'Over budget' });
    expect(rej.body.data.quotes.find((q: { id: string }) => q.id === q3).status).toBe('REJECTED');
    const cancelled = await c.post(`/requests/${req2}/cancel`, {});
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect((await c.post(`/requests/${req2}/cancel`, {})).status).toBe(409);
  });

  it('creates a request with no matching vendors and flags it for admins', async () => {
    const c = await newCustomer(app);
    const r = await createRequest(c, ref, { serviceAreaId: ref.areas['Delta 2'], categoryIds: [ref.categories['party-supplies']] });
    expect(r.status).toBe(201);
    expect(r.body.data.matchedVendors).toBe(0);
    await outbox.dispatchPending(500);
    const a = await admin(app);
    const notes = await a.get('/notifications');
    expect(notes.body.data.items.map((n: { type: string }) => n.type)).toContain('event_request.unmatched');
  });

  it('rejects event dates in the past or too far ahead', async () => {
    const c = await newCustomer(app);
    expect((await createRequest(c, ref, { eventDate: futureDate(0) })).body.error.code).toBe('DATE_TOO_SOON');
    expect((await createRequest(c, ref, { eventDate: futureDate(800) })).body.error.code).toBe('DATE_TOO_FAR');
    const bad = await createRequest(c, ref, { guestCount: 0, categoryIds: [] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['categoryIds', 'guestCount']);
  });
});
