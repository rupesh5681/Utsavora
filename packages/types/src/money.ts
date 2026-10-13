/**
 * Money is always integer paise (1 INR = 100 paise). Rates are basis points (1% = 100 bps).
 * Rounding: half-up to the nearest paisa, applied once per computed line.
 */

export function assertPaise(n: number, field = 'amount'): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${field} must be a non-negative integer number of paise`);
}

/** round(amount * bps / 10000), half-up, integer-only arithmetic. */
export function applyBps(amountPaise: number, bps: number): number {
  assertPaise(amountPaise);
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError('bps must be a non-negative integer');
  return Math.floor((amountPaise * bps + 5000) / 10000);
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return '—';
  return inr.format(paise / 100);
}

export interface QuoteLineInput {
  description: string;
  quantity: number;
  unitPricePaise: number;
}

export interface QuoteTotalsInput {
  items: QuoteLineInput[];
  discountPaise: number;
  deliveryPaise: number;
  taxBps: number;
  advanceBps: number;
}

export interface QuoteTotals {
  lines: (QuoteLineInput & { lineTotalPaise: number })[];
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
}

/**
 * Canonical quote pricing. The API always recomputes with this function and
 * never trusts totals sent by a client.
 *
 *   subtotal = Σ quantity × unit price
 *   taxable  = subtotal − discount          (discount may not exceed subtotal)
 *   tax      = taxable × taxBps             (GST on goods/services; delivery treated as non-taxable here)
 *   total    = taxable + tax + delivery
 *   advance  = total × advanceBps
 */
export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  if (input.items.length === 0) throw new RangeError('A quote needs at least one line item');
  const lines = input.items.map((it) => {
    if (!Number.isInteger(it.quantity) || it.quantity < 1) throw new RangeError('quantity must be a positive integer');
    assertPaise(it.unitPricePaise, 'unitPricePaise');
    const lineTotalPaise = it.quantity * it.unitPricePaise;
    if (!Number.isSafeInteger(lineTotalPaise)) throw new RangeError('line total too large');
    return { ...it, lineTotalPaise };
  });
  const subtotalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  assertPaise(input.discountPaise, 'discountPaise');
  assertPaise(input.deliveryPaise, 'deliveryPaise');
  if (input.discountPaise > subtotalPaise) throw new RangeError('discount cannot exceed subtotal');
  if (input.advanceBps > 10000) throw new RangeError('advance cannot exceed 100%');
  const taxablePaise = subtotalPaise - input.discountPaise;
  const taxPaise = applyBps(taxablePaise, input.taxBps);
  const totalPaise = taxablePaise + taxPaise + input.deliveryPaise;
  const advancePaise = applyBps(totalPaise, input.advanceBps);
  return {
    lines,
    subtotalPaise,
    discountPaise: input.discountPaise,
    taxablePaise,
    taxPaise,
    deliveryPaise: input.deliveryPaise,
    totalPaise,
    advancePaise,
    balancePaise: totalPaise - advancePaise,
  };
}

/**
 * Platform commission is charged on the taxable service value (excludes GST and delivery).
 * vendorPayable = total − commission. GST on the commission itself is out of scope for the MVP.
 */
export function computeCommission(taxablePaise: number, totalPaise: number, commissionBps: number) {
  const commissionPaise = applyBps(taxablePaise, commissionBps);
  return { commissionPaise, vendorPayablePaise: totalPaise - commissionPaise };
}
