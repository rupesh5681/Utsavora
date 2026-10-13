import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import {
  admin,
  bootApp,
  createRequest,
  futureDate,
  newCustomer,
  newVendor,
  PASSWORD,
  refData,
  revisionBody,
  Session,
  vendorQuoteFor,
  type Ref,
} from './helpers';
import type { Db } from '../src/db/client';
import { userAdminPermissions, userRoles, users } from '../src/db/schema';
import { toCsv } from '../src/admin/admin.service';

let app: INestApplication;
let db: Db;
let ref: Ref;

beforeAll(async () => {
  ({ app, db } = await bootApp());
  ref = await refData(app);
});
afterAll(() => app.close());

describe('authentication', () => {
  it('requires the app header on writes (CSRF defence)', async () => {
    const r = await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'x@y.z', password: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_APP_HEADER');
  });

  it('uses a generic error for bad credentials and checks the app role', async () => {
    const c = await newCustomer(app);
    const s = new Session(app, 'customer');
    const bad = await s.post('/auth/login', { email: c.email, password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await s.post('/auth/login', { email: 'nobody@test.local', password: 'wrong-password-1' });
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    const v = new Session(app, 'vendor');
    const wrongApp = await v.post('/auth/login', { email: c.email, password: PASSWORD });
    expect(wrongApp.status).toBe(403);
  });

  it('keeps sessions separate per app and revokes on logout', async () => {
    const c = new Session(app, 'customer');
    const reg = await c.post('/auth/register', { name: 'Session Test', email: `sess-${Date.now()}@test.local`, phone: '9876543210', password: PASSWORD });
    const cookie = String(([] as string[]).concat(reg.headers['set-cookie'] ?? [])[0]).split(';')[0];
    expect((await c.get('/auth/me')).body.data.role).toBe('CUSTOMER');
    // Same cookie jar, but asking as the vendor app reads a different cookie → unauthenticated.
    const asVendor = await c.agent.get('/v1/auth/me').set('x-utsavora-app', 'vendor');
    expect(asVendor.status).toBe(401);
    // Keep a copy of the cookie, then log out: the copied token must stop working.
    await c.post('/auth/logout').expect(200);
    expect((await c.get('/auth/me')).status).toBe(401);
    const replay = await request(app.getHttpServer()).get('/v1/auth/me').set('x-utsavora-app', 'customer').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });

  it('rejects duplicate registration and weak passwords', async () => {
    const c = await newCustomer(app);
    const s = new Session(app, 'customer');
    const dup = await s.post('/auth/register', { name: 'X', email: c.email, phone: '9876543210', password: PASSWORD });
    expect(dup.status).toBe(409);
    const weak = await s.post('/auth/register', { name: 'X', email: 'weak@test.local', phone: '9876543210', password: 'password' });
    expect(weak.status).toBe(422);
  });

  it('sets httpOnly SameSite cookies', async () => {
    const s = new Session(app, 'customer');
    const r = await s.post('/auth/register', { name: 'Cookie Test', email: `cookie-${Date.now()}@test.local`, phone: '9876543210', password: PASSWORD });
    const set = String(r.headers['set-cookie']);
    expect(set).toContain('uts_customer=');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
  });
});

describe('authorization and data isolation', () => {
  it('isolates vendors from each other and customers from each other', async () => {
    const area = 'Beta 2';
    const vA = await newVendor(app, ref, { areas: [area] });
    const vB = await newVendor(app, ref, { areas: ['Gamma 2'] }); // not invited
    const cA = await newCustomer(app);
    const cB = await newCustomer(app);
    const reqId = (await createRequest(cA, ref, { serviceAreaId: ref.areas[area] })).body.data.id;
    const q = await vendorQuoteFor(vA, reqId);
    const rev = (await vA.post(`/vendor/quotes/${q}/revisions`, revisionBody())).body.data.revisions[0];

    expect((await vB.get(`/vendor/quotes/${q}`)).status).toBe(404);
    expect((await vB.post(`/vendor/quotes/${q}/revisions`, revisionBody())).status).toBe(404);
    expect((await cB.get(`/requests/${reqId}`)).status).toBe(404);
    expect((await cB.post(`/requests/${reqId}/quotes/${q}/accept`, { revisionId: rev.id })).status).toBe(404);

    const order = (await cA.post(`/requests/${reqId}/quotes/${q}/accept`, { revisionId: rev.id })).body.data;
    expect((await cB.get(`/orders/${order.id}`)).status).toBe(404);
    expect((await vB.get(`/orders/${order.id}`)).status).toBe(404);
    expect((await vB.post(`/orders/${order.id}/actions`, { action: 'vendor_confirm' })).status).toBe(404);
    // Customer cannot perform vendor actions on their own order.
    const wrongActor = await cA.post(`/orders/${order.id}/actions`, { action: 'vendor_confirm' });
    expect(wrongActor.status).toBe(409);
    expect(wrongActor.body.error.message).toContain('not permitted');
    // Cross-role endpoints.
    expect((await cA.get('/vendor/quotes')).status).toBe(403);
    expect((await vA.get('/admin/dashboard')).status).toBe(403);
    expect((await vA.post('/requests', {})).status).toBe(403);
    // Lists are scoped.
    expect((await vB.get('/orders')).body.meta.total).toBe(0);
  });

  it('enforces explicit admin permissions', async () => {
    const email = `limited-${Date.now()}@test.local`;
    const [u] = await db.insert(users).values({ email, name: 'Support Agent', phone: '9999900000', passwordHash: await hash(PASSWORD) }).returning();
    await db.insert(userRoles).values({ userId: u.id, role: 'ADMIN' });
    await db.insert(userAdminPermissions).values({ userId: u.id, permission: 'VENDORS_REVIEW' });
    const s = new Session(app, 'admin');
    await s.post('/auth/login', { email, password: PASSWORD }).expect(200);
    expect((await s.get('/admin/vendors')).status).toBe(200);
    const denied = await s.get('/admin/orders');
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toContain('ORDERS_MANAGE');
    expect((await s.put('/admin/settings/commission', { defaultBps: 0 })).status).toBe(403);
    expect((await s.get('/admin/orders/export.csv')).status).toBe(403);
    await db.delete(users).where(eq(users.id, u.id));
  });

  it('blocks unapproved vendors from quoting and requires complete onboarding for approval', async () => {
    const draft = await newVendor(app, ref, { approve: false, areas: ['Gamma 1'] });
    const a = await admin(app);
    const premature = await a.post(`/admin/vendors/${draft.vendorId}/decision`, { decision: 'approve' });
    expect(premature.status).toBe(409); // DRAFT cannot be approved — must be submitted first

    // A fresh vendor with an incomplete profile can't submit.
    const bare = new Session(app, 'vendor');
    await bare.post('/auth/register-vendor', { name: 'N', email: `bare-${Date.now()}@test.local`, phone: '9811122233', password: PASSWORD, businessName: 'Bare Biz' });
    const sub = await bare.post('/vendor/me/submit');
    expect(sub.status).toBe(422);
    expect(sub.body.error.code).toBe('ONBOARDING_INCOMPLETE');
    expect(sub.body.error.details.map((d: { key: string }) => d.key)).toEqual(expect.arrayContaining(['description', 'categories', 'areas']));

    // Food vendors need FSSAI.
    const noFssai = await bare.put('/vendor/me', {
      businessName: 'Bare Biz',
      description: 'A description that is comfortably longer than fifty characters in total.',
      phone: '9811122233',
      categoryIds: [ref.categories.catering],
      serviceAreaIds: [ref.areas['Gamma 1']],
    });
    expect(noFssai.body.data.checklist.find((c: { key: string }) => c.key === 'fssai').done).toBe(false);

    // Suspended vendor's listings disappear and it can't quote.
    const v = await newVendor(app, ref, { areas: ['Omicron'] });
    const listing = await v.post('/vendor/listings', {
      categoryId: ref.categories.catering,
      title: 'Suspension test thali',
      description: 'A test listing to verify suspension hides public listings.',
      type: 'MENU',
      pricingMode: 'PER_GUEST',
      pricePaise: 40000,
      foodPreference: 'VEG',
      occasionIds: [ref.occasions.birthday],
    });
    await v.post(`/vendor/listings/${listing.body.data.id}/submit`).expect(200);
    await a.post(`/admin/listings/${listing.body.data.id}/decision`, { decision: 'approve' }).expect(200);
    const pub = new Session(app, 'customer');
    expect((await pub.get(`/listings/${listing.body.data.id}`)).status).toBe(200);
    const c = await newCustomer(app);
    const reqId = (await createRequest(c, ref, { serviceAreaId: ref.areas['Omicron'] })).body.data.id;
    const q = await vendorQuoteFor(v, reqId);
    expect((await a.post(`/admin/vendors/${v.vendorId}/decision`, { decision: 'suspend' })).body.error.code).toBe('NOTES_REQUIRED');
    await a.post(`/admin/vendors/${v.vendorId}/decision`, { decision: 'suspend', notes: 'Customer complaints under review' }).expect(200);
    expect((await pub.get(`/listings/${listing.body.data.id}`)).status).toBe(404);
    const blocked = await v.post(`/vendor/quotes/${q}/revisions`, revisionBody());
    expect(blocked.status).toBe(403);
  });
});

describe('listing moderation', () => {
  it('only shows approved listings and takes edited listings offline for re-approval', async () => {
    const v = await newVendor(app, ref, { areas: ['Sigma'], categories: ['catering', 'decoration'] });
    const a = await admin(app);
    const pub = new Session(app, 'customer');
    const body = {
      categoryId: ref.categories.decoration,
      title: `Marigold mandap ${Date.now()}`,
      description: 'Fresh marigold mandap with drapes, fairy lights and entrance toran.',
      type: 'PACKAGE',
      pricingMode: 'FIXED',
      pricePaise: 2500000,
      inclusions: ['Mandap', 'Toran'],
      occasionIds: [ref.occasions.wedding],
    };
    const created = await v.post('/vendor/listings', body);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect((await pub.get(`/listings/${id}`)).status).toBe(404);
    await v.post(`/vendor/listings/${id}/submit`).expect(200);
    const rej = await a.post(`/admin/listings/${id}/decision`, { decision: 'reject', notes: 'Add photos of past work' });
    expect(rej.body.data.status).toBe('REJECTED');
    const mine = await v.get('/vendor/listings');
    expect(mine.body.data.find((l: { id: string }) => l.id === id).lastModeration.notes).toBe('Add photos of past work');
    await v.post(`/vendor/listings/${id}/submit`).expect(200);
    await a.post(`/admin/listings/${id}/decision`, { decision: 'approve' }).expect(200);
    expect((await pub.get(`/listings/${id}`)).status).toBe(200);
    const search = await pub.get(`/listings?occasion=wedding&category=decoration&area=greater-noida-sigma`);
    expect(search.body.data.map((l: { id: string }) => l.id)).toContain(id);

    const edited = await v.put(`/vendor/listings/${id}`, { ...body, pricePaise: 2700000 });
    expect(edited.body.data.status).toBe('PENDING_REVIEW');
    expect((await pub.get(`/listings/${id}`)).status).toBe(404);
    expect((await v.delete(`/vendor/listings/${id}`)).status).toBe(409);

    // Can't list in a category the vendor doesn't offer; price required unless on quote.
    expect((await v.post('/vendor/listings', { ...body, categoryId: ref.categories.photography })).body.error.code).toBe('CATEGORY_NOT_OFFERED');
    expect((await v.post('/vendor/listings', { ...body, pricePaise: null })).status).toBe(422);
  });
});

describe('booking concurrency', () => {
  it('never double-books a vendor beyond capacity when customers accept at the same time', async () => {
    const area = 'Delta 1';
    const v = await newVendor(app, ref, { areas: [area], maxEventsPerDay: 1 });
    const date = futureDate(45);
    const customers = await Promise.all([newCustomer(app), newCustomer(app), newCustomer(app)]);
    const accepts: { c: Session; req: string; q: string; rev: string }[] = [];
    for (const c of customers) {
      const req = (await createRequest(c, ref, { serviceAreaId: ref.areas[area], eventDate: date })).body.data.id;
      const q = await vendorQuoteFor(v, req);
      const rev = (await v.post(`/vendor/quotes/${q}/revisions`, revisionBody())).body.data.revisions[0].id;
      accepts.push({ c, req, q, rev });
    }
    const results = await Promise.all(accepts.map((a) => a.c.post(`/requests/${a.req}/quotes/${a.q}/accept`, { revisionId: a.rev })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'VENDOR_FULLY_BOOKED')).toBe(true);
    const orders = await v.get('/orders');
    expect(orders.body.meta.total).toBe(1);
  });

  it('frees capacity when a booking is cancelled', async () => {
    const area = 'Alpha 2';
    const v = await newVendor(app, ref, { areas: [area], maxEventsPerDay: 1 });
    const date = futureDate(50);
    const [c1, c2] = await Promise.all([newCustomer(app), newCustomer(app)]);
    const r1 = (await createRequest(c1, ref, { serviceAreaId: ref.areas[area], eventDate: date })).body.data.id;
    const r2 = (await createRequest(c2, ref, { serviceAreaId: ref.areas[area], eventDate: date })).body.data.id;
    const q1 = await vendorQuoteFor(v, r1);
    const q2 = await vendorQuoteFor(v, r2);
    const rev1 = (await v.post(`/vendor/quotes/${q1}/revisions`, revisionBody())).body.data.revisions[0].id;
    const rev2 = (await v.post(`/vendor/quotes/${q2}/revisions`, revisionBody())).body.data.revisions[0].id;
    const o1 = (await c1.post(`/requests/${r1}/quotes/${q1}/accept`, { revisionId: rev1 })).body.data;
    expect((await c2.post(`/requests/${r2}/quotes/${q2}/accept`, { revisionId: rev2 })).status).toBe(409);
    await c1.post(`/orders/${o1.id}/actions`, { action: 'customer_cancel', reason: 'Plans changed' }).expect(200);
    expect((await c2.post(`/requests/${r2}/quotes/${q2}/accept`, { revisionId: rev2 })).status).toBe(200);
  });

  it('accepts a quote exactly once under concurrent double-clicks', async () => {
    const area = 'Beta 1';
    const v = await newVendor(app, ref, { areas: [area], maxEventsPerDay: 5 });
    const c = await newCustomer(app);
    const req = (await createRequest(c, ref, { serviceAreaId: ref.areas[area] })).body.data.id;
    const q = await vendorQuoteFor(v, req);
    const rev = (await v.post(`/vendor/quotes/${q}/revisions`, revisionBody())).body.data.revisions[0].id;
    const results = await Promise.all([1, 2, 3].map(() => c.post(`/requests/${req}/quotes/${q}/accept`, { revisionId: rev })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await c.get('/orders')).body.meta.total).toBe(1);
  });
});

describe('admin settings and exports', () => {
  it('updates commission rules with an audit trail; new orders use them, old orders keep theirs', async () => {
    const a = await admin(app);
    const before = (await a.get('/admin/settings/commission')).body.data;
    expect(before.defaultBps).toBe(1000);
    const updated = await a.put('/admin/settings/commission', { defaultBps: 1200, categoryOverrides: [{ categoryId: ref.categories.catering, bps: 700 }] });
    expect(updated.body.data.defaultBps).toBe(1200);
    expect(updated.body.data.categories.find((c: { slug: string }) => c.slug === 'catering').bps).toBe(700);
    const audit = await a.get('/admin/audit-logs?entityType=settings');
    expect(audit.body.data[0].action).toBe('settings.commission_updated');
    expect(audit.body.data[0].metadata.before.defaultBps).toBe(1000);
    // restore
    await a.put('/admin/settings/commission', { defaultBps: 1000, categoryOverrides: [{ categoryId: ref.categories.catering, bps: 800 }] }).expect(200);
    expect((await a.put('/admin/settings/commission', { defaultBps: 9000 })).status).toBe(422);
  });

  it('escapes CSV cells and neutralises spreadsheet formulas', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'Sharma, Asha', c: 'line\nbreak' }], [
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B' },
      { key: 'c', header: 'C' },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Sharma, Asha"');
    expect(csv).toContain('"line\nbreak"');
  });

  it('serves an admin dashboard from real data', async () => {
    const a = await admin(app);
    const d = await a.get('/admin/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.data.vendorsApproved).toBeGreaterThan(0);
    expect(typeof d.body.data.ordersByStatus).toBe('object');
  });
});

describe('platform', () => {
  it('returns uniform error envelopes and never leaks internals', async () => {
    const pub = new Session(app, 'customer');
    const nf = await pub.get('/listings/00000000-0000-0000-0000-000000000000');
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Listing not found', requestId: expect.any(String) } });
    const badUuid = await pub.get('/listings/not-a-uuid');
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.error).toBeDefined();
  });

  it('exposes health checks and paginated search', async () => {
    const pub = new Session(app, 'customer');
    expect((await pub.get('/health/ready')).body.data.status).toBe('ready');
    const s = await pub.get('/listings?pageSize=1&sort=price_asc');
    expect(s.body.meta).toMatchObject({ page: 1, pageSize: 1 });
    const est = await pub.post('/estimates/budget', { guestCount: 50, categorySlugs: ['catering', 'photography'], foodPreference: 'NON_VEG', budgetPaise: 12000000 });
    expect(est.body.data.lowPaise).toBe(50 * 55000 + 1200000);
    expect(est.body.data.fit).toBe('ok');
  });
});
