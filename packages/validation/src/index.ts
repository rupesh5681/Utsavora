import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().default('');
const id = z.string().min(1).max(64);
const paise = z.number().int("Must be a whole number of paise").min(0).max(2_000_000_000, "Amount cannot exceed ₹2 crore"); // fits a Postgres INT column
const bps = (max: number) => z.number().int().min(0).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const indianMobile = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^\+91/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number');

export const FoodPreferenceSchema = z.enum(['VEG', 'NON_VEG', 'JAIN', 'MIXED', 'NOT_APPLICABLE']);
export const AppAudience = z.enum(['customer', 'vendor', 'admin']);
export type AppAudience = z.infer<typeof AppAudience>;

// ---------- Auth ----------
export const RegisterCustomerSchema = z.object({
  name: trimmed(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: indianMobile,
  password,
});
export type RegisterCustomerInput = z.infer<typeof RegisterCustomerSchema>;

export const RegisterVendorSchema = RegisterCustomerSchema.extend({ businessName: trimmed(150) });
export type RegisterVendorInput = z.infer<typeof RegisterVendorSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// ---------- Vendor ----------
export const VendorProfileSchema = z.object({
  businessName: trimmed(150),
  description: z.string().trim().max(3000).default(''),
  phone: indianMobile,
  city: trimmed(80).default('Greater Noida'),
  addressLine: optionalText(300),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN format')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  fssaiNumber: z
    .string()
    .trim()
    .regex(/^\d{14}$/, 'FSSAI licence number has 14 digits')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  maxEventsPerDay: z.number().int().min(1).max(50).default(2),
  categoryIds: z.array(id).min(1, 'Choose at least one service category').max(20),
  serviceAreaIds: z.array(id).min(1, 'Choose at least one service area').max(100),
});
export type VendorProfileInput = z.infer<typeof VendorProfileSchema>;

export const ListingSchema = z
  .object({
    categoryId: id,
    title: trimmed(150),
    description: z.string().trim().min(20, 'Describe the listing in at least 20 characters').max(5000),
    type: z.enum(['SERVICE', 'PACKAGE', 'MENU']),
    pricingMode: z.enum(['FIXED', 'PER_GUEST', 'ON_QUOTE']),
    pricePaise: paise.nullable().optional(),
    minGuests: z.number().int().min(1).max(10000).nullable().optional(),
    maxGuests: z.number().int().min(1).max(10000).nullable().optional(),
    foodPreference: FoodPreferenceSchema.default('NOT_APPLICABLE'),
    inclusions: z.array(trimmed(200)).max(40).default([]),
    occasionIds: z.array(id).max(20).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.pricingMode !== 'ON_QUOTE' && (v.pricePaise == null || v.pricePaise <= 0)) {
      ctx.addIssue({ code: 'custom', path: ['pricePaise'], message: 'Price is required unless pricing is on quote' });
    }
    if (v.minGuests && v.maxGuests && v.minGuests > v.maxGuests) {
      ctx.addIssue({ code: 'custom', path: ['maxGuests'], message: 'Max guests must be at least min guests' });
    }
  });
export type ListingInput = z.infer<typeof ListingSchema>;

// ---------- Event requests ----------
export const EventRequestSchema = z.object({
  occasionId: id,
  title: z.string().trim().max(120).optional().default(''),
  eventDate: isoDate,
  eventTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  serviceAreaId: id,
  venueAddress: optionalText(300),
  guestCount: z.number().int().min(1, 'At least 1 guest').max(5000),
  budgetPaise: paise.min(100_00, 'Budget must be at least ₹100'),
  foodPreference: FoodPreferenceSchema,
  categoryIds: z.array(id).min(1, 'Choose at least one service').max(10),
  notes: z.string().trim().max(2000).default(''),
  /** Optional: send to these vendors only (e.g. from a listing page). Otherwise all matching approved vendors. */
  vendorIds: z.array(id).max(10).optional(),
});
export type EventRequestInput = z.infer<typeof EventRequestSchema>;

// ---------- Quotes ----------
export const QuoteLineSchema = z.object({
  description: trimmed(200),
  quantity: z.number().int().min(1).max(100000),
  unitPricePaise: paise,
});

export const QuoteRevisionSchema = z.object({
  items: z.array(QuoteLineSchema).min(1, 'Add at least one line item').max(50),
  discountPaise: paise.default(0),
  deliveryPaise: paise.default(0),
  taxBps: bps(2800).default(0), // GST, e.g. 500 = 5%, 1800 = 18%
  advanceBps: bps(10000).default(2500),
  inclusions: z.array(trimmed(200)).max(40).default([]),
  exclusions: z.array(trimmed(200)).max(40).default([]),
  terms: z.string().trim().max(3000).default(''),
  notes: z.string().trim().max(2000).default(''),
  validUntil: isoDate,
});
export type QuoteRevisionInput = z.infer<typeof QuoteRevisionSchema>;

export const ReasonSchema = z.object({ reason: z.string().trim().max(500).optional().default('') });
export type ReasonInput = z.infer<typeof ReasonSchema>;

export const AcceptQuoteSchema = z.object({
  /** The revision the customer saw. Rejected if the vendor has revised since. */
  revisionId: id,
});
export type AcceptQuoteInput = z.infer<typeof AcceptQuoteSchema>;

// ---------- Orders ----------
export const OrderActionSchema = z.object({
  action: z.enum(['vendor_confirm', 'start', 'complete', 'customer_cancel', 'vendor_cancel', 'admin_cancel']),
  reason: z.string().trim().max(500).optional().default(''),
});
export type OrderActionInput = z.infer<typeof OrderActionSchema>;

export const RecordPaymentSchema = z.object({
  amountPaise: paise.min(1),
  method: z.enum(['UPI', 'BANK_TRANSFER', 'CASH', 'CHEQUE']),
  reference: trimmed(100),
  receivedOn: isoDate,
  notes: z.string().trim().max(500).optional().default(''),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

// ---------- Admin ----------
export const ModerationDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'suspend']),
  notes: z.string().trim().max(1000).optional().default(''),
});
export type ModerationDecisionInput = z.infer<typeof ModerationDecisionSchema>;

export const CommissionSettingsSchema = z.object({
  defaultBps: bps(5000),
  categoryOverrides: z.array(z.object({ categoryId: id, bps: bps(5000) })).max(50).default([]),
});
export type CommissionSettingsInput = z.infer<typeof CommissionSettingsSchema>;

// ---------- Queries ----------
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ListingSearchSchema = PageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  occasion: z.string().max(64).optional(),
  category: z.string().max(64).optional(),
  area: z.string().max(64).optional(),
  food: FoodPreferenceSchema.optional(),
  maxPricePaise: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).default('relevance'),
});
export type ListingSearchInput = z.infer<typeof ListingSearchSchema>;

export const BudgetEstimateSchema = z.object({
  guestCount: z.number().int().min(1).max(5000),
  categorySlugs: z.array(z.string().max(64)).min(1).max(10),
  foodPreference: FoodPreferenceSchema.optional(),
  budgetPaise: paise.nullable().optional(),
});
export type BudgetEstimateInput = z.infer<typeof BudgetEstimateSchema>;

export const OrderListQuerySchema = PageQuerySchema.extend({
  status: z.enum(['PENDING_CONFIRMATION', 'PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

export { z };
