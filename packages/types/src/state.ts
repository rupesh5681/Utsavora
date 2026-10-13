import { OrderStatus, QuoteStatus, VendorStatus, ListingStatus, Role } from './enums';

/**
 * Explicit state machines. The API is the only place these are enforced;
 * the web apps import them only to decide which buttons to show.
 */

export type Actor = Role | 'SYSTEM';

interface Transition<S extends string> {
  from: S[];
  to: S;
  by: Actor[];
}

export const ORDER_TRANSITIONS: Record<string, Transition<OrderStatus>> = {
  vendor_confirm: { from: ['PENDING_CONFIRMATION'], to: 'PAYMENT_PENDING', by: ['VENDOR'] },
  record_advance: { from: ['PAYMENT_PENDING'], to: 'CONFIRMED', by: ['ADMIN'] },
  start: { from: ['CONFIRMED'], to: 'IN_PROGRESS', by: ['VENDOR', 'ADMIN'] },
  complete: { from: ['IN_PROGRESS'], to: 'COMPLETED', by: ['VENDOR', 'ADMIN'] },
  customer_cancel: { from: ['PENDING_CONFIRMATION', 'PAYMENT_PENDING'], to: 'CANCELLED', by: ['CUSTOMER'] },
  vendor_cancel: { from: ['PENDING_CONFIRMATION'], to: 'CANCELLED', by: ['VENDOR'] },
  admin_cancel: { from: ['PENDING_CONFIRMATION', 'PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS'], to: 'CANCELLED', by: ['ADMIN'] },
};
export type OrderAction = keyof typeof ORDER_TRANSITIONS;

/** Order statuses that occupy a vendor's capacity on the event date. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.PAYMENT_PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_PROGRESS,
];

/** Quote statuses in which a vendor may submit a new revision. */
export const QUOTE_REVISABLE: QuoteStatus[] = [
  QuoteStatus.REQUESTED,
  QuoteStatus.VENDOR_REVIEWING,
  QuoteStatus.QUOTED,
  QuoteStatus.REVISED,
];
/** Quote statuses a customer may accept. */
export const QUOTE_ACCEPTABLE: QuoteStatus[] = [QuoteStatus.QUOTED, QuoteStatus.REVISED];
/** Terminal quote statuses. */
export const QUOTE_TERMINAL: QuoteStatus[] = [
  QuoteStatus.ACCEPTED,
  QuoteStatus.DECLINED,
  QuoteStatus.REJECTED,
  QuoteStatus.NOT_SELECTED,
  QuoteStatus.WITHDRAWN,
  QuoteStatus.EXPIRED,
];

export const VENDOR_TRANSITIONS: Record<string, Transition<VendorStatus>> = {
  submit: { from: ['DRAFT', 'REJECTED'], to: 'PENDING_REVIEW', by: ['VENDOR'] },
  approve: { from: ['PENDING_REVIEW', 'SUSPENDED'], to: 'APPROVED', by: ['ADMIN'] },
  reject: { from: ['PENDING_REVIEW'], to: 'REJECTED', by: ['ADMIN'] },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED', by: ['ADMIN'] },
};

export const LISTING_TRANSITIONS: Record<string, Transition<ListingStatus>> = {
  submit: { from: ['DRAFT', 'REJECTED'], to: 'PENDING_REVIEW', by: ['VENDOR'] },
  approve: { from: ['PENDING_REVIEW', 'SUSPENDED'], to: 'APPROVED', by: ['ADMIN'] },
  reject: { from: ['PENDING_REVIEW'], to: 'REJECTED', by: ['ADMIN'] },
  suspend: { from: ['APPROVED'], to: 'SUSPENDED', by: ['ADMIN'] },
};

export function canTransition<S extends string>(
  table: Record<string, Transition<S>>,
  action: string,
  current: S,
  actor: Actor,
): { ok: true; to: S } | { ok: false; reason: string } {
  const t = table[action];
  if (!t) return { ok: false, reason: `Unknown action "${action}"` };
  if (!t.by.includes(actor)) return { ok: false, reason: `Action "${action}" is not permitted for ${actor}` };
  if (!t.from.includes(current)) return { ok: false, reason: `Cannot ${action.replace(/_/g, ' ')} from status ${current}` };
  return { ok: true, to: t.to };
}

/** Actions available to an actor from the current state — UI convenience only. */
export function availableActions<S extends string>(table: Record<string, Transition<S>>, current: S, actor: Actor): string[] {
  return Object.entries(table)
    .filter(([, t]) => t.by.includes(actor) && t.from.includes(current))
    .map(([name]) => name);
}
