// String values here MUST match the Prisma enums in apps/api/prisma/schema.prisma.

export const Role = { CUSTOMER: 'CUSTOMER', VENDOR: 'VENDOR', ADMIN: 'ADMIN' } as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Fine-grained admin permissions. Admins hold an explicit subset; SUPER is implied by none. */
export const AdminPermission = {
  VENDORS_REVIEW: 'VENDORS_REVIEW',
  LISTINGS_MODERATE: 'LISTINGS_MODERATE',
  ORDERS_MANAGE: 'ORDERS_MANAGE',
  PAYMENTS_RECORD: 'PAYMENTS_RECORD',
  SETTINGS_MANAGE: 'SETTINGS_MANAGE',
  AUDIT_VIEW: 'AUDIT_VIEW',
} as const;
export type AdminPermission = (typeof AdminPermission)[keyof typeof AdminPermission];
export const ALL_ADMIN_PERMISSIONS = Object.values(AdminPermission);

export const VendorStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

export const ListingStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];

export const ListingType = { SERVICE: 'SERVICE', PACKAGE: 'PACKAGE', MENU: 'MENU' } as const;
export type ListingType = (typeof ListingType)[keyof typeof ListingType];

export const PricingMode = { FIXED: 'FIXED', PER_GUEST: 'PER_GUEST', ON_QUOTE: 'ON_QUOTE' } as const;
export type PricingMode = (typeof PricingMode)[keyof typeof PricingMode];

export const FoodPreference = { VEG: 'VEG', NON_VEG: 'NON_VEG', JAIN: 'JAIN', MIXED: 'MIXED', NOT_APPLICABLE: 'NOT_APPLICABLE' } as const;
export type FoodPreference = (typeof FoodPreference)[keyof typeof FoodPreference];

export const EventRequestStatus = {
  OPEN: 'OPEN',
  ACCEPTED: 'ACCEPTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type EventRequestStatus = (typeof EventRequestStatus)[keyof typeof EventRequestStatus];

export const QuoteStatus = {
  REQUESTED: 'REQUESTED',
  VENDOR_REVIEWING: 'VENDOR_REVIEWING',
  QUOTED: 'QUOTED',
  REVISED: 'REVISED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED', // vendor declined to quote
  REJECTED: 'REJECTED', // customer rejected this quote
  NOT_SELECTED: 'NOT_SELECTED', // customer accepted another vendor's quote
  WITHDRAWN: 'WITHDRAWN',
  EXPIRED: 'EXPIRED',
} as const;
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];

export const OrderStatus = {
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentMethod = { UPI: 'UPI', BANK_TRANSFER: 'BANK_TRANSFER', CASH: 'CASH', CHEQUE: 'CHEQUE' } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  OPEN: 'Open',
  ACCEPTED: 'Accepted',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  REQUESTED: 'Requested',
  VENDOR_REVIEWING: 'Vendor reviewing',
  QUOTED: 'Quoted',
  REVISED: 'Revised',
  DECLINED: 'Declined by vendor',
  NOT_SELECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn',
  PENDING_CONFIRMATION: 'Awaiting vendor confirmation',
  PAYMENT_PENDING: 'Advance payment pending',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  VEG: 'Veg',
  NON_VEG: 'Non-veg',
  JAIN: 'Jain',
  MIXED: 'Veg + Non-veg',
  NOT_APPLICABLE: 'Not applicable',
  FIXED: 'Fixed price',
  PER_GUEST: 'Per guest',
  ON_QUOTE: 'On quote',
  SERVICE: 'Service',
  PACKAGE: 'Package',
  MENU: 'Menu',
  UPI: 'UPI',
  BANK_TRANSFER: 'bank transfer',
  CASH: 'cash',
  CHEQUE: 'cheque',
};

export function label(value: string | null | undefined): string {
  if (!value) return '';
  return LABELS[value] ?? value;
}
