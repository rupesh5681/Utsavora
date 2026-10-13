import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RegisterCustomerSchema, ListingSchema, EventRequestSchema, QuoteRevisionSchema } from './index';

test('normalises Indian mobile numbers and rejects weak passwords', () => {
  const ok = RegisterCustomerSchema.parse({ name: 'Asha', email: 'ASHA@Example.com', phone: '+91 98765-43210', password: 'celebrate2026' });
  assert.equal(ok.phone, '9876543210');
  assert.equal(ok.email, 'asha@example.com');
  assert.equal(RegisterCustomerSchema.safeParse({ name: 'A', email: 'a@b.co', phone: '1234567890', password: 'celebrate2026' }).success, false);
  assert.equal(RegisterCustomerSchema.safeParse({ name: 'A', email: 'a@b.co', phone: '9876543210', password: 'short1' }).success, false);
});

test('listing price required unless on quote', () => {
  const base = { categoryId: 'c', title: 'Veg thali', description: 'A generous North Indian veg thali menu.', type: 'MENU', foodPreference: 'VEG' };
  assert.equal(ListingSchema.safeParse({ ...base, pricingMode: 'PER_GUEST' }).success, false);
  assert.equal(ListingSchema.safeParse({ ...base, pricingMode: 'ON_QUOTE' }).success, true);
  assert.equal(ListingSchema.safeParse({ ...base, pricingMode: 'PER_GUEST', pricePaise: 45000 }).success, true);
});

test('event request requires services and sane numbers', () => {
  const base = { occasionId: 'o', eventDate: '2026-12-01', serviceAreaId: 'a', guestCount: 80, budgetPaise: 5000000, foodPreference: 'VEG', categoryIds: ['c'] };
  assert.equal(EventRequestSchema.safeParse(base).success, true);
  assert.equal(EventRequestSchema.safeParse({ ...base, categoryIds: [] }).success, false);
  assert.equal(EventRequestSchema.safeParse({ ...base, guestCount: 0 }).success, false);
  assert.equal(EventRequestSchema.safeParse({ ...base, budgetPaise: 12.5 }).success, false);
});

test('quote revision caps GST and advance', () => {
  const base = { items: [{ description: 'Buffet', quantity: 10, unitPricePaise: 50000 }], validUntil: '2026-12-01' };
  assert.equal(QuoteRevisionSchema.safeParse(base).success, true);
  assert.equal(QuoteRevisionSchema.safeParse({ ...base, taxBps: 3000 }).success, false);
  assert.equal(QuoteRevisionSchema.safeParse({ ...base, advanceBps: 10001 }).success, false);
});
