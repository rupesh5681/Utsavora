/** Response shapes returned by the Utsavora API (see docs/openapi.json). */

export interface Me {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'CUSTOMER' | 'VENDOR' | 'ADMIN';
  permissions: string[];
  vendor: { id: string; businessName: string; status: string; slug: string; isDemo: boolean } | null;
}

export interface Occasion {
  id: string;
  slug: string;
  name: string;
  description: string;
}
export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  requiresFssai: boolean;
  defaultTaxBps: number;
}
export interface ServiceArea {
  id: string;
  slug: string;
  name: string;
  city: string;
}

export interface ListingSummary {
  id: string;
  title: string;
  description: string;
  type: string;
  pricingMode: string;
  pricePaise: number | null;
  minGuests: number | null;
  maxGuests: number | null;
  foodPreference: string;
  inclusions: string[];
  isDemo: boolean;
  vendor: { id: string; slug: string; businessName: string; isDemo: boolean };
  category: { id: string; slug: string; name: string };
}
export interface ListingDetail extends ListingSummary {
  occasions: { id: string; slug: string; name: string }[];
  serviceAreas: { id: string; slug: string; name: string; city: string }[];
}

export interface VendorProfilePublic {
  id: string;
  slug: string;
  businessName: string;
  description: string;
  city: string;
  isDemo: boolean;
  fssaiVerified: boolean;
  gstRegistered: boolean;
  memberSince: string | null;
  serviceAreas: ServiceArea[];
  categories: { id: string; slug: string; name: string }[];
  listings: ListingSummary[];
}

export interface BudgetEstimate {
  lines: { categorySlug: string; categoryName: string; lowPaise: number; highPaise: number; basis: string }[];
  lowPaise: number;
  highPaise: number;
  budgetPaise: number | null;
  fit: 'under' | 'tight' | 'ok' | null;
  warnings: string[];
  disclaimer: string;
}

export interface QuoteRevision {
  id: string;
  revisionNumber: number;
  items: { description: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[];
  subtotalPaise: number;
  discountPaise: number;
  taxBps: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  advanceBps: number;
  advancePaise: number;
  inclusions: string[];
  exclusions: string[];
  terms: string;
  notes: string;
  validUntil: string;
  createdAt: string;
}

export interface EventRequestSummary {
  id: string;
  reference: string;
  title: string;
  occasion: string;
  area: string;
  eventDate: string;
  guestCount: number;
  budgetPaise: number;
  status: string;
  vendorsInvited: number;
  quotesReceived: number;
  createdAt: string;
}

export interface EventRequestDetail {
  id: string;
  reference: string;
  title: string;
  status: string;
  occasion: { id: string; name: string; slug: string };
  serviceArea: { id: string; name: string; city: string };
  categories: { id: string; name: string; slug: string }[];
  eventDate: string;
  eventTime: string | null;
  venueAddress: string;
  guestCount: number;
  budgetPaise: number;
  foodPreference: string;
  notes: string;
  createdAt: string;
  order: { id: string; orderNumber: string; status: string } | null;
  quotes: {
    id: string;
    status: string;
    declineReason: string | null;
    vendor: { id: string; slug: string; businessName: string; isDemo: boolean };
    currentRevisionId: string | null;
    revisions: QuoteRevision[];
    updatedAt: string;
  }[];
}

export interface VendorRequestView {
  id: string;
  reference: string;
  title: string;
  status: string;
  occasion: string;
  area: string;
  eventDate: string;
  eventTime: string | null;
  guestCount: number;
  budgetPaise: number;
  foodPreference: string;
  notes: string;
  venueLocality: string;
  categories: { id: string; name: string; slug: string }[];
}

export interface VendorInboxItem {
  id: string;
  status: string;
  updatedAt: string;
  latest: { id: string; totalPaise: number; revisionNumber: number; validUntil: string } | null;
  request: VendorRequestView;
}

export interface VendorQuoteDetail {
  id: string;
  status: string;
  declineReason: string | null;
  currentRevisionId: string | null;
  customerFirstName: string;
  request: VendorRequestView;
  revisions: QuoteRevision[];
  competingQuotes: number;
  order: { id: string; orderNumber: string; status: string } | null;
  vendorStatus: string;
  canQuote: boolean;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  eventDate: string;
  guestCount: number;
  totalPaise: number;
  advancePaise: number;
  paidPaise: number;
  commissionPaise?: number;
  vendorPayablePaise?: number;
  isDemo: boolean;
  createdAt: string;
  occasion: string;
  area: string;
  vendor: { id: string; businessName: string };
  customer: { id: string; name: string };
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  mode: string;
  status: string;
  isDemo: boolean;
  eventDate: string;
  guestCount: number;
  eventRequestId: string | null;
  quoteId: string | null;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  advancePaise: number;
  paidPaise: number;
  balancePaise: number;
  cancelReason: string | null;
  createdAt: string;
  snapshot: {
    acceptedAt: string;
    event: {
      reference: string;
      title: string;
      occasion: string;
      eventDate: string;
      eventTime: string | null;
      area: string;
      city: string;
      venueAddress: string;
      guestCount: number;
      foodPreference: string;
      notes: string;
      services: string[];
    };
    vendor: { businessName: string; phone: string; gstin: string | null; fssaiNumber: string | null; isDemo: boolean };
    customer: { name: string };
    quote: Omit<QuoteRevision, 'id' | 'createdAt'> & { revisionId: string };
  };
  vendor: { id: string; businessName: string; phone: string; slug: string; isDemo: boolean };
  customer: { id: string; name: string; phone?: string; email?: string };
  timeline: { id: string; action: string; actorRole: string; fromStatus: string | null; toStatus: string; note: string; createdAt: string }[];
  payments: { id: string; provider: string; kind: string; status: string; method: string | null; amountPaise: number; receivedOn: string | null; createdAt: string; reference?: string }[];
  actions: string[];
  canRecordPayment: boolean;
  commissionBps?: number;
  commissionPaise?: number;
  vendorPayablePaise?: number;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export interface VendorSelf {
  id: string;
  slug: string;
  businessName: string;
  description: string;
  phone: string;
  city: string;
  addressLine: string;
  gstin: string | null;
  fssaiNumber: string | null;
  maxEventsPerDay: number;
  status: string;
  isDemo: boolean;
  categoryIds: string[];
  serviceAreaIds: string[];
  latestReview: { decision: string; notes: string; createdAt: string } | null;
  checklist: ChecklistItem[];
}

export interface VendorListing {
  id: string;
  categoryId: string;
  category: { id: string; name: string; slug: string };
  title: string;
  description: string;
  type: string;
  pricingMode: string;
  pricePaise: number | null;
  minGuests: number | null;
  maxGuests: number | null;
  foodPreference: string;
  inclusions: string[];
  occasionIds: string[];
  status: string;
  isDemo: boolean;
  updatedAt: string;
  lastModeration: { decision: string; notes: string; createdAt: string } | null;
}
