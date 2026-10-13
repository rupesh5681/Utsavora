import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBps, computeQuoteTotals, computeCommission } from './money';
import { canTransition, ORDER_TRANSITIONS } from './state';
import { estimateBudget } from './budget';

test('applyBps rounds half-up in integer paise', () => {
  assert.equal(applyBps(10000, 500), 500);
  assert.equal(applyBps(101, 5000), 51); // 50.5 -> 51
  assert.equal(applyBps(99, 5000), 50); // 49.5 -> 50
  assert.equal(applyBps(0, 1800), 0);
});

test('computeQuoteTotals: subtotal, discount, GST, delivery, advance', () => {
  const t = computeQuoteTotals({
    items: [
      { description: 'Veg buffet', quantity: 100, unitPricePaise: 55000 },
      { description: 'Live chaat counter', quantity: 1, unitPricePaise: 800000 },
    ],
    discountPaise: 300000,
    deliveryPaise: 150000,
    taxBps: 500,
    advanceBps: 3000,
  });
  assert.equal(t.subtotalPaise, 6300000);
  assert.equal(t.taxablePaise, 6000000);
  assert.equal(t.taxPaise, 300000);
  assert.equal(t.totalPaise, 6450000);
  assert.equal(t.advancePaise, 1935000);
  assert.equal(t.balancePaise, 4515000);
});

test('computeQuoteTotals rejects bad input', () => {
  const base = { discountPaise: 0, deliveryPaise: 0, taxBps: 0, advanceBps: 0 };
  assert.throws(() => computeQuoteTotals({ ...base, items: [] }));
  assert.throws(() => computeQuoteTotals({ ...base, items: [{ description: 'x', quantity: 0, unitPricePaise: 1 }] }));
  assert.throws(() => computeQuoteTotals({ ...base, items: [{ description: 'x', quantity: 1, unitPricePaise: 1.5 }] }));
  assert.throws(() => computeQuoteTotals({ ...base, discountPaise: 5, items: [{ description: 'x', quantity: 1, unitPricePaise: 1 }] }));
  assert.throws(() => computeQuoteTotals({ ...base, advanceBps: 10001, items: [{ description: 'x', quantity: 1, unitPricePaise: 1 }] }));
});

test('commission is on taxable value, payable is the rest', () => {
  assert.deepEqual(computeCommission(6000000, 6450000, 1000), { commissionPaise: 600000, vendorPayablePaise: 5850000 });
});

test('order state machine enforces actor and source state', () => {
  assert.deepEqual(canTransition(ORDER_TRANSITIONS, 'vendor_confirm', 'PENDING_CONFIRMATION', 'VENDOR'), { ok: true, to: 'PAYMENT_PENDING' });
  assert.equal(canTransition(ORDER_TRANSITIONS, 'vendor_confirm', 'PENDING_CONFIRMATION', 'CUSTOMER').ok, false);
  assert.equal(canTransition(ORDER_TRANSITIONS, 'customer_cancel', 'CONFIRMED', 'CUSTOMER').ok, false);
  assert.equal(canTransition(ORDER_TRANSITIONS, 'record_advance', 'PAYMENT_PENDING', 'VENDOR').ok, false);
});

test('budget estimate picks food-preference rate and flags fit', () => {
  const rates = [
    { categorySlug: 'catering', categoryName: 'Catering', unit: 'PER_GUEST' as const, lowPaise: 45000, highPaise: 75000, foodPreference: 'VEG' },
    { categorySlug: 'catering', categoryName: 'Catering', unit: 'PER_GUEST' as const, lowPaise: 60000, highPaise: 100000, foodPreference: 'NON_VEG' },
    { categorySlug: 'decoration', categoryName: 'Decoration', unit: 'FLAT' as const, lowPaise: 1500000, highPaise: 4000000 },
  ];
  const e = estimateBudget(rates, { guestCount: 100, categorySlugs: ['catering', 'decoration', 'dj'], foodPreference: 'VEG', budgetPaise: 5000000 });
  assert.equal(e.lowPaise, 4500000 + 1500000);
  assert.equal(e.highPaise, 7500000 + 4000000);
  assert.equal(e.fit, 'under');
  assert.equal(e.warnings.length, 2);
});
