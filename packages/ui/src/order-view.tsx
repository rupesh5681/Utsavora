'use client';
import { useState, type ReactNode } from 'react';
import type { OrderDetail } from '@utsavora/api-client';
import { Bill, Button, DemoTag, Dialog, ErrorBox, formatDate, formatINR, label, LineItems, OrderTimeline, StatusBadge, TextArea } from './components';
import { useAction } from './data';

const STEPS = [
  { key: 'PENDING_CONFIRMATION', text: 'Vendor confirms' },
  { key: 'PAYMENT_PENDING', text: 'Advance paid' },
  { key: 'CONFIRMED', text: 'Confirmed' },
  { key: 'IN_PROGRESS', text: 'Event day' },
  { key: 'COMPLETED', text: 'Completed' },
];

const ACTION_COPY: Record<string, { button: string; title: string; body: string; variant: 'primary' | 'danger' | 'peacock'; reason: 'none' | 'optional' | 'required' }> = {
  vendor_confirm: { button: 'Confirm booking', title: 'Confirm this booking?', body: 'You commit to serve this event on the agreed terms. The customer is asked to pay the advance next.', variant: 'primary', reason: 'none' },
  start: { button: 'Mark in progress', title: 'Mark the event as in progress?', body: 'Use this on the event day once setup has started.', variant: 'peacock', reason: 'none' },
  complete: { button: 'Mark completed', title: 'Mark the event as completed?', body: 'Do this after the event is delivered. The customer will be able to see the booking as completed.', variant: 'peacock', reason: 'none' },
  customer_cancel: { button: 'Cancel booking', title: 'Cancel this booking?', body: 'The vendor will be told immediately. If you have paid anything, Utsavora will contact you about a refund.', variant: 'danger', reason: 'optional' },
  vendor_cancel: { button: 'Cancel booking', title: 'Cancel this booking?', body: 'Only cancel if you truly cannot serve this event. The customer will be notified.', variant: 'danger', reason: 'required' },
  admin_cancel: { button: 'Cancel booking', title: 'Cancel this booking as Utsavora?', body: 'Both the customer and vendor will be notified. Record the reason for the audit trail.', variant: 'danger', reason: 'required' },
};

function Progress({ status }: { status: string }) {
  if (status === 'CANCELLED') return null;
  const idx = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="progress" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < idx || status === 'COMPLETED' ? 'done' : i === idx ? 'now' : ''} aria-current={i === idx ? 'step' : undefined}>
          {s.text}
        </li>
      ))}
    </ol>
  );
}

export function OrderView({
  order,
  onChange,
  viewer,
  aside,
  paymentNote,
}: {
  order: OrderDetail;
  onChange: (o: OrderDetail) => void;
  viewer: 'customer' | 'vendor' | 'admin';
  aside?: ReactNode;
  paymentNote?: ReactNode;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const act = useAction((api, action: string, r: string) => api.post<OrderDetail>(`/orders/${order.id}/actions`, { action, reason: r || undefined }));
  const s = order.snapshot;
  const copy = pending ? ACTION_COPY[pending] : null;

  return (
    <div className="stack-lg">
      {order.isDemo && (
        <div className="demo-banner">
          Demo booking. It was made with a demonstration vendor and is not a real order or payment.
        </div>
      )}
      <div className="split">
        <div className="stack-lg">
          <section className="stack">
            <div className="row">
              <StatusBadge status={order.status} />
              <DemoTag show={order.isDemo} />
            </div>
            <Progress status={order.status} />
            {order.status === 'CANCELLED' && order.cancelReason && <div className="alert alert-error">Cancelled: {order.cancelReason}</div>}
            {order.status === 'PAYMENT_PENDING' && paymentNote}
            {order.actions.length > 0 && (
              <div className="row">
                {order.actions.map((a) => (
                  <Button
                    key={a}
                    variant={ACTION_COPY[a]?.variant === 'danger' ? 'danger' : ACTION_COPY[a]?.variant ?? 'primary'}
                    onClick={() => {
                      setReason('');
                      act.setError(null);
                      setPending(a);
                    }}
                  >
                    {ACTION_COPY[a]?.button ?? label(a)}
                  </Button>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h3>Event</h3>
            <dl className="kv">
              <dt>Occasion</dt>
              <dd>{s.event.occasion}</dd>
              <dt>Date</dt>
              <dd>
                {formatDate(s.event.eventDate)}
                {s.event.eventTime ? ` at ${s.event.eventTime}` : ''}
              </dd>
              <dt>Area</dt>
              <dd>
                {s.event.area}, {s.event.city}
              </dd>
              {viewer !== 'customer' || s.event.venueAddress ? (
                <>
                  <dt>Venue</dt>
                  <dd>{s.event.venueAddress || 'Not provided yet'}</dd>
                </>
              ) : null}
              <dt>Guests</dt>
              <dd>{s.event.guestCount}</dd>
              <dt>Food</dt>
              <dd>{label(s.event.foodPreference)}</dd>
              <dt>Services</dt>
              <dd>{s.event.services.join(', ')}</dd>
              {s.event.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{s.event.notes}</dd>
                </>
              )}
              <dt>Request</dt>
              <dd>{s.event.reference}</dd>
            </dl>
          </section>

          <section className="stack">
            <h3 style={{ margin: 0 }}>Agreed quote (revision {s.quote.revisionNumber})</h3>
            <LineItems items={s.quote.items} />
            <div className="grid-2">
              {s.quote.inclusions.length > 0 && (
                <div>
                  <h4>Included</h4>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {s.quote.inclusions.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              )}
              {s.quote.exclusions.length > 0 && (
                <div>
                  <h4>Not included</h4>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {s.quote.exclusions.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {s.quote.terms && (
              <p className="small">
                <strong>Terms: </strong>
                {s.quote.terms}
              </p>
            )}
          </section>

          <section>
            <h3>History</h3>
            <OrderTimeline events={order.timeline} />
          </section>
        </div>

        <aside className="stack">
          <section className="panel stack" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>Payment</h3>
            <Bill r={{ ...s.quote, totalPaise: order.totalPaise }} paidPaise={order.paidPaise} />
            {order.payments.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {order.payments.map((p) => (
                  <li key={p.id}>
                    {formatINR(p.amountPaise)} {p.method ? `by ${label(p.method)}` : ''} on {formatDate(p.receivedOn ?? p.createdAt, 'short')}
                    {p.reference ? ` (ref ${p.reference})` : ''}
                  </li>
                ))}
              </ul>
            )}
            {viewer !== 'customer' && order.commissionPaise !== undefined && (
              <dl className="kv" style={{ marginTop: 6 }}>
                <dt>Platform fee ({(order.commissionBps ?? 0) / 100}%)</dt>
                <dd className="num">{formatINR(order.commissionPaise)}</dd>
                <dt>Vendor payable</dt>
                <dd className="num">{formatINR(order.vendorPayablePaise)}</dd>
              </dl>
            )}
          </section>
          <section className="panel">
            <h3>{viewer === 'vendor' ? 'Customer' : 'Vendor'}</h3>
            {viewer === 'vendor' ? (
              <dl className="kv">
                <dt>Name</dt>
                <dd>{order.customer.name}</dd>
                <dt>Mobile</dt>
                <dd>{order.customer.phone ? <a href={`tel:+91${order.customer.phone}`}>+91 {order.customer.phone}</a> : '—'}</dd>
              </dl>
            ) : (
              <dl className="kv">
                <dt>Business</dt>
                <dd>{s.vendor.businessName}</dd>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:+91${s.vendor.phone}`}>+91 {s.vendor.phone}</a>
                </dd>
                {s.vendor.fssaiNumber && (
                  <>
                    <dt>FSSAI</dt>
                    <dd>{s.vendor.fssaiNumber}</dd>
                  </>
                )}
                {s.vendor.gstin && (
                  <>
                    <dt>GSTIN</dt>
                    <dd>{s.vendor.gstin}</dd>
                  </>
                )}
              </dl>
            )}
            {viewer === 'admin' && (
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>Customer</dt>
                <dd>
                  {order.customer.name}, +91 {order.customer.phone}
                </dd>
                <dt>Email</dt>
                <dd>{order.customer.email}</dd>
              </dl>
            )}
          </section>
          {aside}
        </aside>
      </div>

      <Dialog open={pending !== null} onClose={() => setPending(null)} title={copy?.title ?? ''}>
        {copy && (
          <div className="stack">
            <p style={{ margin: 0 }}>{copy.body}</p>
            {copy.reason !== 'none' && (
              <TextArea
                label={copy.reason === 'required' ? 'Reason' : 'Reason (optional)'}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            <ErrorBox error={act.error} />
            <div className="row">
              <Button
                variant={copy.variant === 'danger' ? 'danger' : 'primary'}
                loading={act.pending}
                disabled={copy.reason === 'required' && !reason.trim()}
                onClick={async () => {
                  const o = await act.run(pending!, reason.trim());
                  if (o) {
                    onChange(o);
                    setPending(null);
                  }
                }}
              >
                {copy.button}
              </Button>
              <Button variant="secondary" onClick={() => setPending(null)}>
                Back
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
