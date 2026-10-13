'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { EventRequestDetail, OrderDetail } from '@utsavora/api-client';
import {
  Async,
  Bill,
  Button,
  DemoTag,
  Dialog,
  Empty,
  ErrorBox,
  formatDate,
  formatINR,
  label,
  LineItems,
  Notice,
  RequireAuth,
  StatusBadge,
  TextArea,
  useAction,
  useQuery,
} from '@utsavora/ui';

type Q = EventRequestDetail['quotes'][number];

function QuoteColumn({ q, best, open, onAccept, onDecline }: { q: Q; best: boolean; open: boolean; onAccept: () => void; onDecline: () => void }) {
  const [showItems, setShowItems] = useState(false);
  const rev = q.revisions[0];
  const prev = q.revisions[1];
  const active = open && (q.status === 'QUOTED' || q.status === 'REVISED');
  return (
    <article className={`quote-col ${best && active ? 'best' : ''}`} aria-label={`Quote from ${q.vendor.businessName}`}>
      <div className="row-between">
        <h3 style={{ margin: 0 }}>
          <Link href={`/vendors/${q.vendor.slug}`}>{q.vendor.businessName}</Link>
        </h3>
        <DemoTag show={q.vendor.isDemo} />
      </div>
      <div className="row">
        <StatusBadge status={q.status} />
        {best && active && <span className="badge badge-wait">Lowest total</span>}
      </div>
      {!rev ? (
        <p className="small muted" style={{ margin: 0 }}>
          {q.status === 'DECLINED' ? (q.declineReason ? `Can't take this event: ${q.declineReason}` : "Can't take this event.") : 'Preparing a quote. We will notify you when it arrives.'}
        </p>
      ) : (
        <>
          <div>
            <div className="total num">{formatINR(rev.totalPaise)}</div>
            <div className="xsmall muted">
              incl. GST. Advance {formatINR(rev.advancePaise)}. Valid until {formatDate(rev.validUntil, 'short')}.
            </div>
            {prev && (
              <div className="xsmall" style={{ marginTop: 4 }}>
                Revision {rev.revisionNumber}, was {formatINR(prev.totalPaise)}
              </div>
            )}
          </div>
          {rev.inclusions.length > 0 && (
            <div>
              <h4>Included</h4>
              <ul>
                {rev.inclusions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
          {rev.exclusions.length > 0 && (
            <div>
              <h4>Not included</h4>
              <ul>
                {rev.exclusions.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} aria-expanded={showItems} onClick={() => setShowItems((s) => !s)}>
            {showItems ? 'Hide price breakdown' : 'Show price breakdown'}
          </button>
          {showItems && (
            <div className="stack" style={{ gap: 10 }}>
              <LineItems items={rev.items} />
              <Bill r={rev} />
              {rev.terms && <p className="small"><strong>Terms: </strong>{rev.terms}</p>}
              {rev.notes && <p className="small"><strong>Note from vendor: </strong>{rev.notes}</p>}
            </div>
          )}
          {active && (
            <div className="row" style={{ marginTop: 'auto' }}>
              <Button onClick={onAccept}>Accept this quote</Button>
              <Button variant="ghost" size="sm" onClick={onDecline}>
                Decline
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function RequestView({ id }: { id: string }) {
  const router = useRouter();
  const sent = useSearchParams().get('sent');
  const q = useQuery(`request:${id}`, (api) => api.get<EventRequestDetail>(`/requests/${id}`));
  const [accepting, setAccepting] = useState<Q | null>(null);
  const [declining, setDeclining] = useState<Q | null>(null);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const accept = useAction((api, quote: Q) => api.post<OrderDetail>(`/requests/${id}/quotes/${quote.id}/accept`, { revisionId: quote.currentRevisionId }));
  const decline = useAction((api, quote: Q, r: string) => api.post<EventRequestDetail>(`/requests/${id}/quotes/${quote.id}/reject`, { reason: r }));
  const cancel = useAction((api) => api.post<EventRequestDetail>(`/requests/${id}/cancel`, {}));

  return (
    <Async state={q} lines={8}>
      {(r) => {
        const open = r.status === 'OPEN';
        const priced = r.quotes.filter((x) => x.revisions[0] && (x.status === 'QUOTED' || x.status === 'REVISED'));
        const lowest = priced.length ? Math.min(...priced.map((x) => x.revisions[0].totalPaise)) : null;
        return (
          <div className="stack-lg">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <div>
                <p className="small muted" style={{ margin: 0 }}>
                  <Link href="/requests">My requests</Link> / {r.reference}
                </p>
                <h1>{r.title}</h1>
                <div className="row">
                  <StatusBadge status={r.status} />
                  <span className="small muted">
                    {formatDate(r.eventDate)}
                    {r.eventTime ? ` at ${r.eventTime}` : ''}, {r.serviceArea.name}, {r.guestCount} guests, budget {formatINR(r.budgetPaise)}
                  </span>
                </div>
              </div>
              {open && (
                <Button variant="danger" size="sm" onClick={() => setCancelling(true)}>
                  Cancel request
                </Button>
              )}
            </div>

            {sent !== null && open && (
              <Notice tone={Number(sent) > 0 ? 'success' : 'warn'}>
                {Number(sent) > 0
                  ? `Request sent to ${sent} matching ${Number(sent) === 1 ? 'vendor' : 'vendors'}. Quotes usually arrive within a day.`
                  : "No vendors cover this area and service yet. Our team has been alerted and will find vendors for you."}
              </Notice>
            )}
            {r.order && (
              <Notice tone="success">
                You booked this event. <Link href={`/orders/${r.order.id}`}>Track booking {r.order.orderNumber}</Link>
              </Notice>
            )}

            <section>
              <h2>Quotes</h2>
              {r.quotes.length === 0 ? (
                <Empty title="Waiting for vendors">We will notify you as soon as a vendor sends a quote.</Empty>
              ) : (
                <div className="compare">
                  {r.quotes.map((x) => (
                    <QuoteColumn
                      key={x.id}
                      q={x}
                      open={open}
                      best={lowest !== null && x.revisions[0]?.totalPaise === lowest && priced.length > 1}
                      onAccept={() => {
                        accept.setError(null);
                        setAccepting(x);
                      }}
                      onDecline={() => {
                        setReason('');
                        setDeclining(x);
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <h3>Your event details</h3>
              <dl className="kv">
                <dt>Occasion</dt>
                <dd>{r.occasion.name}</dd>
                <dt>Services</dt>
                <dd>{r.categories.map((c) => c.name).join(', ')}</dd>
                <dt>Food</dt>
                <dd>{label(r.foodPreference)}</dd>
                {r.venueAddress && (
                  <>
                    <dt>Venue</dt>
                    <dd>{r.venueAddress}</dd>
                  </>
                )}
                {r.notes && (
                  <>
                    <dt>Notes</dt>
                    <dd>{r.notes}</dd>
                  </>
                )}
              </dl>
            </section>

            <Dialog open={accepting !== null} onClose={() => setAccepting(null)} title="Book this vendor?">
              {accepting?.revisions[0] && (
                <div className="stack">
                  <p style={{ margin: 0 }}>
                    You are accepting <strong>{accepting.vendor.businessName}</strong>&apos;s quote (revision {accepting.revisions[0].revisionNumber}) for{' '}
                    <strong>{formatINR(accepting.revisions[0].totalPaise)}</strong>.
                  </p>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Other vendors will be told you chose someone else.</li>
                    <li>{accepting.vendor.businessName} confirms the booking next.</li>
                    <li>
                      Then you pay the advance of {formatINR(accepting.revisions[0].advancePaise)}. Our team shares verified payment details; nothing is charged now.
                    </li>
                  </ul>
                  {accepting.vendor.isDemo && <div className="demo-banner">This is a demo vendor. The booking will be marked as a demo and is not a real order.</div>}
                  <ErrorBox error={accept.error} />
                  <div className="row">
                    <Button
                      loading={accept.pending}
                      onClick={async () => {
                        const o = await accept.run(accepting);
                        if (o) router.push(`/orders/${o.id}?new=1`);
                        else void q.reload();
                      }}
                    >
                      Confirm booking request
                    </Button>
                    <Button variant="secondary" onClick={() => setAccepting(null)}>
                      Keep comparing
                    </Button>
                  </div>
                </div>
              )}
            </Dialog>

            <Dialog open={declining !== null} onClose={() => setDeclining(null)} title="Decline this quote?">
              <div className="stack">
                <TextArea label="Tell the vendor why (optional)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Over budget, menu didn't fit…" />
                <ErrorBox error={decline.error} />
                <div className="row">
                  <Button
                    variant="danger"
                    loading={decline.pending}
                    onClick={async () => {
                      const d = await decline.run(declining!, reason);
                      if (d) {
                        q.setData(d);
                        setDeclining(null);
                      }
                    }}
                  >
                    Decline quote
                  </Button>
                  <Button variant="secondary" onClick={() => setDeclining(null)}>
                    Back
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog open={cancelling} onClose={() => setCancelling(false)} title="Cancel this request?">
              <div className="stack">
                <p style={{ margin: 0 }}>Vendors will stop working on quotes for this event. You can create a new request any time.</p>
                <ErrorBox error={cancel.error} />
                <div className="row">
                  <Button
                    variant="danger"
                    loading={cancel.pending}
                    onClick={async () => {
                      const d = await cancel.run();
                      if (d) {
                        q.setData(d);
                        setCancelling(false);
                      }
                    }}
                  >
                    Cancel request
                  </Button>
                  <Button variant="secondary" onClick={() => setCancelling(false)}>
                    Keep it open
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>
        );
      }}
    </Async>
  );
}

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="container page">
      <RequireAuth>
        <RequestView id={id} />
      </RequireAuth>
    </div>
  );
}

