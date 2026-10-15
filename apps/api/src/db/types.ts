/**
 * Kysely table types for the SQL Server schema in migrations/*.sql.
 * Columns are snake_case in the database and camelCase here (CamelCasePlugin).
 * JSON columns are typed as their parsed shape: the JsonDatePlugin parses them on read,
 * and writers must pass JSON.stringify(...) (use the `json()` helper in client.ts).
 * DATE columns are 'YYYY-MM-DD' strings on read (JsonDatePlugin) and accept the same on write.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  AdminPermission,
  EventRequestStatus,
  FoodPreference,
  ListingStatus,
  ListingType,
  OrderStatus,
  PaymentMethod,
  PricingMode,
  QuoteStatus,
  Role,
  VendorStatus,
} from '@utsavora/types';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type DefaultedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** DATE column: read as 'YYYY-MM-DD', written as 'YYYY-MM-DD'. */
type DateOnly = ColumnType<string, string, string>;
type Id = ColumnType<string, string | undefined, never>;
/** JSON stored in NVARCHAR(MAX): parsed on read, stringified on write. */
type Json<T> = ColumnType<T, string, string>;
type JsonDefaulted<T> = ColumnType<T, string | undefined, string>;

export interface UsersTable {
  id: Id;
  email: string;
  phone: string;
  name: string;
  passwordHash: string;
  isActive: Generated<boolean>;
  createdAt: DefaultedTimestamp;
  updatedAt: DefaultedTimestamp;
}
export interface UserRolesTable {
  userId: string;
  role: Role;
  createdAt: DefaultedTimestamp;
}
export interface UserAdminPermissionsTable {
  userId: string;
  permission: AdminPermission;
  grantedAt: DefaultedTimestamp;
}
export interface SessionsTable {
  id: Id;
  userId: string;
  tokenHash: string;
  audience: string;
  expiresAt: Timestamp;
  revokedAt: Timestamp | null;
  lastSeenAt: DefaultedTimestamp;
  ip: string | null;
  userAgent: string | null;
  createdAt: DefaultedTimestamp;
}
export interface OccasionsTable {
  id: Id;
  slug: string;
  name: string;
  description: string;
  sortOrder: Generated<number>;
  createdAt: DefaultedTimestamp;
}
export interface CategoriesTable {
  id: Id;
  slug: string;
  name: string;
  description: Generated<string>;
  requiresFssai: Generated<boolean>;
  defaultTaxBps: Generated<number>;
  sortOrder: Generated<number>;
  createdAt: DefaultedTimestamp;
}
export interface ServiceAreasTable {
  id: Id;
  slug: string;
  name: string;
  city: string;
  isActive: Generated<boolean>;
  createdAt: DefaultedTimestamp;
}
export interface BudgetRatesTable {
  id: Id;
  categoryId: string;
  unit: 'PER_GUEST' | 'FLAT' | 'PER_50_GUESTS';
  lowPaise: number;
  highPaise: number;
  foodPreference: FoodPreference | null;
  updatedAt: DefaultedTimestamp;
}
export interface VendorsTable {
  id: Id;
  slug: string;
  businessName: string;
  description: Generated<string>;
  phone: string;
  city: Generated<string>;
  addressLine: Generated<string>;
  gstin: string | null;
  fssaiNumber: string | null;
  maxEventsPerDay: Generated<number>;
  status: Generated<VendorStatus>;
  isDemo: Generated<boolean>;
  submittedAt: Timestamp | null;
  approvedAt: Timestamp | null;
  createdAt: DefaultedTimestamp;
  updatedAt: DefaultedTimestamp;
}
export interface VendorMembersTable {
  vendorId: string;
  userId: string;
  role: Generated<'OWNER' | 'STAFF'>;
  createdAt: DefaultedTimestamp;
}
export interface VendorCategoriesTable {
  vendorId: string;
  categoryId: string;
}
export interface VendorServiceAreasTable {
  vendorId: string;
  serviceAreaId: string;
}
export interface VendorVerificationReviewsTable {
  id: Id;
  vendorId: string;
  reviewerId: string;
  decision: string;
  fromStatus: VendorStatus;
  toStatus: VendorStatus;
  notes: Generated<string>;
  createdAt: DefaultedTimestamp;
}
export interface ListingsTable {
  id: Id;
  vendorId: string;
  categoryId: string;
  title: string;
  description: string;
  type: ListingType;
  pricingMode: PricingMode;
  pricePaise: number | null;
  minGuests: number | null;
  maxGuests: number | null;
  foodPreference: Generated<FoodPreference>;
  inclusions: JsonDefaulted<string[]>;
  status: Generated<ListingStatus>;
  isDemo: Generated<boolean>;
  submittedAt: Timestamp | null;
  approvedAt: Timestamp | null;
  createdAt: DefaultedTimestamp;
  updatedAt: DefaultedTimestamp;
}
export interface ListingOccasionsTable {
  listingId: string;
  occasionId: string;
}
export interface ModerationActionsTable {
  id: Id;
  listingId: string;
  moderatorId: string;
  decision: string;
  fromStatus: ListingStatus;
  toStatus: ListingStatus;
  notes: Generated<string>;
  createdAt: DefaultedTimestamp;
}
export interface EventRequestsTable {
  id: Id;
  reference: string;
  customerId: string;
  occasionId: string;
  serviceAreaId: string;
  title: Generated<string>;
  eventDate: DateOnly;
  eventTime: string | null;
  venueAddress: Generated<string>;
  guestCount: number;
  budgetPaise: number;
  foodPreference: FoodPreference;
  notes: Generated<string>;
  status: Generated<EventRequestStatus>;
  createdAt: DefaultedTimestamp;
  updatedAt: DefaultedTimestamp;
}
export interface EventRequestCategoriesTable {
  eventRequestId: string;
  categoryId: string;
}
export interface QuotesTable {
  id: Id;
  eventRequestId: string;
  vendorId: string;
  status: Generated<QuoteStatus>;
  currentRevisionId: string | null;
  declineReason: string | null;
  createdAt: DefaultedTimestamp;
  updatedAt: DefaultedTimestamp;
}
export interface QuoteRevisionsTable {
  id: Id;
  quoteId: string;
  revisionNumber: number;
  subtotalPaise: number;
  discountPaise: number;
  taxBps: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  advanceBps: number;
  advancePaise: number;
  inclusions: JsonDefaulted<string[]>;
  exclusions: JsonDefaulted<string[]>;
  terms: Generated<string>;
  notes: Generated<string>;
  validUntil: DateOnly;
  createdById: string;
  createdAt: DefaultedTimestamp;
}
export interface QuoteItemsTable {
  id: Id;
  revisionId: string;
  position: number;
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}
export interface OrdersTable {
  id: Id;
  orderNumber: string;
  mode: Generated<'QUOTE' | 'INSTANT'>;
  customerId: string;
  vendorId: string;
  eventRequestId: string | null;
  quoteId: string | null;
  acceptedRevisionId: string | null;
  status: Generated<OrderStatus>;
  eventDate: DateOnly;
  guestCount: number;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  advancePaise: number;
  commissionBps: number;
  commissionPaise: number;
  vendorPayablePaise: number;
  paidPaise: Generated<number>;
  snapshot: Json<unknown>;
  isDemo: Generated<boolean>;
  cancelReason: string | null;
  createdAt: DefaultedTimestamp;
  updatedAt: DefaultedTimestamp;
}
export interface OrderEventsTable {
  id: Id;
  orderId: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: Generated<string>;
  createdAt: DefaultedTimestamp;
}
export interface PaymentsTable {
  id: Id;
  orderId: string;
  provider: 'MANUAL' | 'SANDBOX';
  kind: 'ADVANCE' | 'BALANCE' | 'FULL';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  method: PaymentMethod | null;
  amountPaise: number;
  reference: string;
  idempotencyKey: string;
  receivedOn: ColumnType<string | null, string | null, string | null>;
  notes: Generated<string>;
  recordedById: string | null;
  createdAt: DefaultedTimestamp;
}
export interface CommissionRulesTable {
  id: Id;
  vendorId: string | null;
  categoryId: string | null;
  bps: number;
  updatedAt: DefaultedTimestamp;
}
export interface NotificationsTable {
  id: Id;
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Timestamp | null;
  createdAt: DefaultedTimestamp;
}
export interface OutboxEventsTable {
  id: Id;
  type: string;
  payload: Json<Record<string, unknown>>;
  attempts: Generated<number>;
  lastError: string | null;
  processedAt: Timestamp | null;
  createdAt: DefaultedTimestamp;
}
export interface AuditLogsTable {
  id: Id;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: JsonDefaulted<Record<string, unknown>>;
  ip: string | null;
  createdAt: DefaultedTimestamp;
}
export interface SchemaMigrationsTable {
  name: string;
  appliedAt: DefaultedTimestamp;
}

export interface Database {
  users: UsersTable;
  userRoles: UserRolesTable;
  userAdminPermissions: UserAdminPermissionsTable;
  sessions: SessionsTable;
  occasions: OccasionsTable;
  categories: CategoriesTable;
  serviceAreas: ServiceAreasTable;
  budgetRates: BudgetRatesTable;
  vendors: VendorsTable;
  vendorMembers: VendorMembersTable;
  vendorCategories: VendorCategoriesTable;
  vendorServiceAreas: VendorServiceAreasTable;
  vendorVerificationReviews: VendorVerificationReviewsTable;
  listings: ListingsTable;
  listingOccasions: ListingOccasionsTable;
  moderationActions: ModerationActionsTable;
  eventRequests: EventRequestsTable;
  eventRequestCategories: EventRequestCategoriesTable;
  quotes: QuotesTable;
  quoteRevisions: QuoteRevisionsTable;
  quoteItems: QuoteItemsTable;
  orders: OrdersTable;
  orderEvents: OrderEventsTable;
  payments: PaymentsTable;
  commissionRules: CommissionRulesTable;
  notifications: NotificationsTable;
  outboxEvents: OutboxEventsTable;
  auditLogs: AuditLogsTable;
  schemaMigrations: SchemaMigrationsTable;
}

export type Vendor = Selectable<VendorsTable>;
export type EventRequest = Selectable<EventRequestsTable>;
export type Quote = Selectable<QuotesTable>;
export type QuoteRevision = Selectable<QuoteRevisionsTable>;
export type QuoteItem = Selectable<QuoteItemsTable>;
export type Order = Selectable<OrdersTable>;
export type Listing = Selectable<ListingsTable>;
export type NewOrder = Insertable<OrdersTable>;
export type OrderUpdate = Updateable<OrdersTable>;
