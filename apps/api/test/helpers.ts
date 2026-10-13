import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { DB, loadConfig } from '../src/config';
import { TEST_DB_URL } from './global-setup';
import { addDays, todayIST } from '../src/common/time';
import type { Db } from '../src/db/client';
import { OutboxService } from '../src/common/outbox.service';

process.env.AUTH_RATE_LIMIT_PER_MINUTE = '10000';
process.env.WRITE_RATE_LIMIT_PER_MINUTE = '10000';

export async function bootApp() {
  const config = { ...loadConfig({ DATABASE_URL: TEST_DB_URL, NODE_ENV: 'test' }), outboxIntervalMs: 0 };
  const app = await createApp(config, { logger: false });
  await app.init();
  return { app, db: app.get<Db>(DB), outbox: app.get(OutboxService) };
}

type Aud = 'customer' | 'vendor' | 'admin';

/** A signed-in browser for one app: keeps its cookie and always sends the app header. */
export class Session {
  readonly agent: ReturnType<typeof request.agent>;
  constructor(
    app: INestApplication,
    readonly aud: Aud,
  ) {
    this.agent = request.agent(app.getHttpServer());
  }
  get(path: string) {
    return this.agent.get(`/v1${path}`).set('x-utsavora-app', this.aud);
  }
  post(path: string, body?: object) {
    return this.agent.post(`/v1${path}`).set('x-utsavora-app', this.aud).send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.agent.put(`/v1${path}`).set('x-utsavora-app', this.aud).send(body ?? {});
  }
  delete(path: string) {
    return this.agent.delete(`/v1${path}`).set('x-utsavora-app', this.aud);
  }
}

let n = 0;
export const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
export const futureDate = (days = 30) => addDays(todayIST(), days);
export const PASSWORD = 'Celebrate-2026';

export async function newCustomer(app: INestApplication, name = 'Asha Sharma') {
  const s = new Session(app, 'customer');
  const email = `cust-${uniq()}@test.local`;
  const r = await s.post('/auth/register', { name, email, phone: '9876543210', password: PASSWORD });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  return Object.assign(s, { email });
}

export async function admin(app: INestApplication) {
  const s = new Session(app, 'admin');
  const r = await s.post('/auth/login', { email: 'admin@test.local', password: 'Admin-Pass-2026' });
  if (r.status !== 200) throw new Error(`admin login failed ${JSON.stringify(r.body)}`);
  return s;
}

export interface Ref {
  occasions: Record<string, string>;
  categories: Record<string, string>;
  areas: Record<string, string>;
}

export async function refData(app: INestApplication): Promise<Ref> {
  const s = new Session(app, 'customer');
  const [o, c, a] = await Promise.all([s.get('/occasions'), s.get('/categories'), s.get('/service-areas')]);
  return {
    occasions: Object.fromEntries(o.body.data.map((x: { slug: string; id: string }) => [x.slug, x.id])),
    categories: Object.fromEntries(c.body.data.map((x: { slug: string; id: string }) => [x.slug, x.id])),
    areas: Object.fromEntries(a.body.data.map((x: { name: string; id: string }) => [x.name, x.id])),
  };
}

/** Registers a vendor, completes onboarding and (by default) gets it approved by an admin. */
export async function newVendor(
  app: INestApplication,
  ref: Ref,
  opts: { approve?: boolean; categories?: string[]; areas?: string[]; maxEventsPerDay?: number; name?: string } = {},
) {
  const s = new Session(app, 'vendor');
  const businessName = opts.name ?? `Test Caterers ${uniq()}`;
  const email = `vendor-${uniq()}@test.local`;
  let r = await s.post('/auth/register-vendor', { name: 'Ravi Kumar', email, phone: '9811122233', password: PASSWORD, businessName });
  if (r.status !== 201) throw new Error(`vendor register failed ${JSON.stringify(r.body)}`);
  const cats = opts.categories ?? ['catering'];
  r = await s.put('/vendor/me', {
    businessName,
    description: 'Family-run caterers serving North Indian vegetarian and Mughlai food across Greater Noida since 2012.',
    phone: '9811122233',
    city: 'Greater Noida',
    fssaiNumber: cats.some((c) => ['catering', 'cakes-desserts'].includes(c)) ? '10020051000999' : '',
    maxEventsPerDay: opts.maxEventsPerDay ?? 2,
    categoryIds: cats.map((c) => ref.categories[c]),
    serviceAreaIds: (opts.areas ?? ['Alpha 1', 'Pari Chowk']).map((a) => ref.areas[a]),
  });
  if (r.status !== 200) throw new Error(`vendor profile failed ${JSON.stringify(r.body)}`);
  const me = r.body.data;
  if (opts.approve !== false) {
    r = await s.post('/vendor/me/submit');
    if (r.status !== 200) throw new Error(`vendor submit failed ${JSON.stringify(r.body)}`);
    const a = await admin(app);
    r = await a.post(`/admin/vendors/${me.id}/decision`, { decision: 'approve', notes: 'Documents verified' });
    if (r.status !== 200) throw new Error(`vendor approve failed ${JSON.stringify(r.body)}`);
  }
  return Object.assign(s, { vendorId: me.id as string, businessName, email });
}

export function revisionBody(over: Record<string, unknown> = {}) {
  return {
    items: [
      { description: 'Veg buffet (per plate)', quantity: 100, unitPricePaise: 55000 },
      { description: 'Live chaat counter', quantity: 1, unitPricePaise: 800000 },
    ],
    discountPaise: 300000,
    deliveryPaise: 150000,
    taxBps: 500,
    advanceBps: 3000,
    inclusions: ['Serving staff', 'Crockery'],
    exclusions: ['Venue'],
    terms: 'Advance is non-refundable within 7 days of the event.',
    validUntil: futureDate(10),
    ...over,
  };
}

export function createRequest(customer: Session, ref: Ref, over: Record<string, unknown> = {}) {
  return customer.post('/requests', {
    occasionId: ref.occasions['birthday'],
    eventDate: futureDate(30),
    eventTime: '19:00',
    serviceAreaId: ref.areas['Alpha 1'],
    venueAddress: 'Tower 4, Example Society, Alpha 1, Greater Noida',
    guestCount: 100,
    budgetPaise: 8000000,
    foodPreference: 'VEG',
    categoryIds: [ref.categories['catering']],
    notes: 'Kids-friendly menu please',
    ...over,
  });
}

/** Finds the vendor's quote thread for an event request. */
export async function vendorQuoteFor(vendor: Session, eventRequestId: string): Promise<string> {
  const r = await vendor.get('/vendor/quotes?pageSize=100');
  const q = r.body.data.find((x: { request: { id: string } }) => x.request.id === eventRequestId);
  if (!q) throw new Error('quote not found in vendor inbox');
  return q.id;
}
