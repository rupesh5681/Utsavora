# Approval workflows and state machines

All transitions live in `packages/types/src/state.ts` and are enforced only by the API. Invalid transitions return `409 INVALID_TRANSITION`.

## Vendor verification

```
DRAFT ──submit──► PENDING_REVIEW ──approve──► APPROVED ──suspend──► SUSPENDED
  ▲                    │                                              │
  └──── (edit) ◄── REJECTED ◄──reject──┘                    approve (reinstate)
```

- **Submit** (vendor) requires the onboarding checklist: business name and valid phone, description ≥ 50 characters, at least one service category and one service area, and an FSSAI licence number when any category is a food category.
- **Approve** (admin, `VENDORS_REVIEW`) re-checks the checklist server-side. Admins should verify FSSAI on FoSCoS and GSTIN on the GST portal; document upload and automated verification are Phase 1 follow-ups.
- **Reject / suspend** require notes, which the vendor sees.
- Only `APPROVED` vendors are matched to requests, appear publicly, can send quotes, or can be booked. Suspension immediately hides listings and blocks quoting and new bookings; existing orders continue under admin supervision.

## Listing moderation (menus, packages, services)

```
DRAFT ──submit──► PENDING_REVIEW ──approve──► APPROVED ──suspend──► SUSPENDED
                        │                         │
                     reject                 vendor edits
                        ▼                         ▼
                    REJECTED ──submit──►    PENDING_REVIEW   (offline until re-approved)
```

A listing is public only when both the listing and its vendor are `APPROVED`. Draft and rejected listings can be deleted; others cannot.

## Event request

`OPEN → ACCEPTED` (customer accepts a quote) · `OPEN → CANCELLED` (customer) · `OPEN → EXPIRED` (event date passed).

## Quote thread (per vendor per request)

```
REQUESTED → VENDOR_REVIEWING → QUOTED → REVISED (repeatable) → ACCEPTED
     │             │              │         │
  DECLINED      DECLINED      WITHDRAWN / REJECTED / EXPIRED / NOT_SELECTED
```

- Revisions are immutable; validity must be between today and the event date.
- Customers accept a specific `revisionId`; if the vendor revised in between, the API returns `QUOTE_REVISED`.
- Quotes past `valid_until` become `EXPIRED` (timer every 10 minutes plus lazy checks on every read and accept).
- When one quote is accepted, the others become `NOT_SELECTED` and those vendors are notified.

## Booking (order)

```
PENDING_CONFIRMATION ──vendor_confirm──► PAYMENT_PENDING ──advance recorded──► CONFIRMED ──start──► IN_PROGRESS ──complete──► COMPLETED
        │                                      │                                  │                    │
 customer_cancel / vendor_cancel /       customer_cancel /                    admin_cancel          admin_cancel
 admin_cancel                            admin_cancel
```

| Action | By | Extra rules |
| --- | --- | --- |
| `vendor_confirm` | vendor | |
| advance recorded | admin (`PAYMENTS_RECORD`) | automatic once verified payments ≥ advance; partial payments keep `PAYMENT_PENDING` |
| `start` | vendor, admin | from the day before the event |
| `complete` | vendor, admin | on or after the event date |
| `customer_cancel` | customer | before `CONFIRMED` |
| `vendor_cancel` | vendor | before vendor confirmation; reason required |
| `admin_cancel` | admin (`ORDERS_MANAGE`) | any time before completion; reason required. If money was paid, the timeline records that a refund is owed. |

Cancelling frees the vendor's capacity for that date. Rescheduling, disputes and refunds are Phase 2.

## Admin permissions

`VENDORS_REVIEW`, `LISTINGS_MODERATE`, `ORDERS_MANAGE`, `PAYMENTS_RECORD`, `SETTINGS_MANAGE`, `AUDIT_VIEW`. The seeded admin holds all of them. Grant a subset for support staff by inserting rows into `user_admin_permissions` (an admin-user management screen is a follow-up).
