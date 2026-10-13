'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { computeQuoteTotals } from '@utsavora/types';
import { QuoteRevisionSchema } from '@utsavora/validation';
import type { QuoteRevision, VendorQuoteDetail } from '@utsavora/api-client';
import {
  Async,
  Bill,
  Button,
  Dialog,
  ErrorBox,
  formatDate,
  formatINR,
  label,
  LineItems,
  ListEditor,
  Notice,
  paiseToRupees,
  rupeesToPaise,
  SelectInput,
  StatusBadge,
  TextArea,
  TextInput,
  todayISO,
  useAction,
  useQuery,
} from '@utsavora/ui';
import { Shell } from '@/components/shell';

interface Line {
  description: string;
  quantity: string;
  unitPrice: string;
}

const GST = [
  { value: '0', label: 'No GST' },
  { value: '500', label: '5%' },
  { value: '1200', label: '12%' },
  { value: '1800', label: '18%' },
];

function QuoteBuilder({ quote, onSent }: { quote: VendorQuoteDetail; onSent: (q: VendorQuoteDetail) => void }) {
  const last: QuoteRevision | undefined = quote.revisions[0];
  const r = quote.request;
  const [lines, setLines] = useState<Line[]>(
    last
      ? last.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: paiseToRupees(i.unitPricePaise) }))
      : [{ description: r.categories.some((c) => c.slug === 'catering') ? `${label(r.foodPreference)} menu (per plate)` : '', quantity: String(r.guestCount), unitPrice: '' }],
  );
  const [discount, setDiscount] = useState(paiseToRupees(last?.discountPaise) || '');
  const [delivery, setDelivery] = useState(paiseToRupees(last?.deliveryPaise) || '');
  const [taxBps, setTaxBps] = useState(String(last?.taxBps ?? (r.categories.some((c) => ['catering', 'cakes-desserts'].includes(c.slug)) ? 500 : 1800)));
  const [advancePct, setAdvancePct] = useState(String((last?.advanceBps ?? 3000) / 100));
  const defaultValidity = [todayISO(7), r.eventDate].sort()[0];
  const [validUntil, setValidUntil] = useState(last && last.validUntil >= todayISO() ? last.validUntil : defaultValidity);
  const [inclusions, setInclusions] = useState<string[]>(last?.inclusions ?? []);
  const [exclusions, setExclusions] = useState<string[]>(last?.exclusions ?? []);
  const [terms, setTerms] = useState(last?.terms ?? '');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const send = useAction((api, body: unknown) => api.post<VendorQuoteDetail>(`/vendor/quotes/${quote.id}/revisions`, body));

  const body = useMemo(
    () => ({
      items: lines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPricePaise: rupeesToPaise(l.unitPrice || '0') })),
      discountPaise: rupeesToPaise(discount || '0'),
      deliveryPaise: rupeesToPaise(delivery || '0'),
      taxBps: Number(taxBps),
      advanceBps: Math.round(Number(advancePct) * 100),
      inclusions: inclusions.map((s) => s.trim()).filter(Boolean),
      exclusions: exclusions.map((s) => s.trim()).filter(Boolean),
      terms,
      notes,
      validUntil,
    }),
    [lines, discount, delivery, taxBps, advancePct, inclusions, exclusions, terms, notes, validUntil],
  );
  const preview = useMemo(() => {
    try {
      return computeQuoteTotals(body);
    } catch {
      return null;
    }
  }, [body]);
  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function submit() {
    const p = QuoteRevisionSchema.safeParse(body);
    if (!p.success) return setErrors(p.error.issues.map((i) => `${i.path.join(' ')}: ${i.message}`));
    setErrors([]);
    const res = await send.run(p.data);
    if (res) onSent(res);
  }

  return (
    <section className="stack-lg" aria-labelledby="builder-h">
      <h2 id="builder-h" style={{ margin: 0 }}>
        {last ? `Revise quote (revision ${last.revisionNumber + 1})` : 'Send your quote'}
      </h2>
      <fieldset className="stack">
        <legend>Line items</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid-3" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(70px,1fr) minmax(90px,1.3fr) auto', alignItems: 'end' }}>
            <TextInput label={i === 0 ? 'Description' : <span className="sr-only">Description</span>} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} />
            <TextInput label={i === 0 ? 'Qty' : <span className="sr-only">Quantity</span>} type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} />
            <TextInput label={i === 0 ? 'Rate' : <span className="sr-only">Rate</span>} prefix="₹" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value.replace(/[^\d.]/g, ''))} />
            <Button variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', unitPrice: '' }])}>
            Add line
          </Button>
        </div>
      </fieldset>
      <div className="form-grid">
        <TextInput label="Discount" prefix="₹" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} />
        <TextInput label="Delivery & setup" prefix="₹" inputMode="decimal" hint="Not taxed in this quote" value={delivery} onChange={(e) => setDelivery(e.target.value.replace(/[^\d.]/g, ''))} />
        <SelectInput label="GST" options={GST} value={taxBps} onChange={(e) => setTaxBps(e.target.value)} />
        <TextInput label="Advance to confirm (%)" type="number" min={0} max={100} value={advancePct} onChange={(e) => setAdvancePct(e.target.value)} />
        <TextInput label="Quote valid until" type="date" min={todayISO()} max={r.eventDate} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
      </div>
      <div className="grid-2">
        <ListEditor legend="Included" value={inclusions} onChange={setInclusions} placeholder="e.g. Serving staff, crockery" />
        <ListEditor legend="Not included" value={exclusions} onChange={setExclusions} placeholder="e.g. Venue, tables" />
      </div>
      <TextArea label="Terms" hint="Cancellation, timings, extra-guest rate" value={terms} maxLength={3000} onChange={(e) => setTerms(e.target.value)} />
      <TextArea label="Message to the customer" hint="Optional" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      <div className="panel panel-haldi stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Customer will see</h3>
        {preview ? <Bill r={{ ...preview, taxBps: Number(taxBps), advanceBps: body.advanceBps }} /> : <p className="small" style={{ margin: 0 }}>Fill in the line items to see totals.</p>}
        <p className="xsmall muted" style={{ margin: 0 }}>Utsavora recalculates totals when you send. The platform fee is deducted from your payout, not added to the customer&apos;s price.</p>
      </div>
      {errors.length > 0 && (
        <div className="alert alert-error" role="alert">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <ErrorBox error={send.error} />
      <div>
        <Button loading={send.pending} onClick={submit} disabled={!preview}>
          {last ? 'Send revised quote' : 'Send quote'}
        </Button>
      </div>
    </section>
  );
}

function QuoteView({ id }: { id: string }) {
  const q = useQuery(`vq:${id}`, (api) => api.get<VendorQuoteDetail>(`/vendor/quotes/${id}`));
  const review = useAction((api) => api.post<VendorQuoteDetail>(`/vendor/quotes/${id}/review`));
  const [closing, setClosing] = useState<'decline' | 'withdraw' | null>(null);
  const [reason, setReason] = useState('');
  const close = useAction((api, kind: string, r: string) => api.post<VendorQuoteDetail>(`/vendor/quotes/${id}/${kind}`, { reason: r }));
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (q.data?.status === 'REQUESTED') void review.run().then((d) => d && q.setData(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.status]);

  return (
    <Async state={q} lines={8}>
      {(d) => {
        const r = d.request;
        return (
          <div className="split">
            <div className="stack-lg">
              <div className="row">
                <StatusBadge status={d.status} />
                {d.competingQuotes > 0 && <span className="small muted">{d.competingQuotes} other vendor{d.competingQuotes > 1 ? 's have' : ' has'} quoted</span>}
              </div>
              {sent && <Notice tone="success">Quote sent. {d.customerFirstName} has been notified.</Notice>}
              {d.order && (
                <Notice tone="success">
                  {d.customerFirstName} accepted your quote. <Link href={`/orders/${d.order.id}`}>Confirm booking {d.order.orderNumber}</Link>
                </Notice>
              )}
              {d.vendorStatus !== 'APPROVED' && <Notice tone="warn">You can send quotes once Utsavora has verified your business.</Notice>}
              {d.status === 'DECLINED' && <Notice>You declined this request{d.declineReason ? `: ${d.declineReason}` : ''}.</Notice>}

              {d.canQuote && (
                <QuoteBuilder
                  key={d.currentRevisionId ?? 'new'}
                  quote={d}
                  onSent={(n) => {
                    q.setData(n);
                    setSent(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              )}

              {d.revisions.length > 0 && (
                <section className="stack">
                  <h2 style={{ margin: 0 }}>Quote history</h2>
                  {d.revisions.map((rev) => (
                    <details key={rev.id} className="panel" open={rev.id === d.currentRevisionId && !d.canQuote}>
                      <summary style={{ cursor: 'pointer' }}>
                        <strong>Revision {rev.revisionNumber}</strong>: {formatINR(rev.totalPaise)}, sent {formatDate(rev.createdAt, 'short')}, valid until {formatDate(rev.validUntil, 'short')}
                      </summary>
                      <div className="stack" style={{ marginTop: 12 }}>
                        <LineItems items={rev.items} />
                        <Bill r={rev} />
                      </div>
                    </details>
                  ))}
                </section>
              )}
            </div>
            <aside className="stack">
              <section className="panel">
                <h3>{r.occasion}</h3>
                <dl className="kv">
                  <dt>Date</dt>
                  <dd>
                    {formatDate(r.eventDate)}
                    {r.eventTime ? ` at ${r.eventTime}` : ''}
                  </dd>
                  <dt>Area</dt>
                  <dd>{r.area}</dd>
                  <dt>Guests</dt>
                  <dd>{r.guestCount}</dd>
                  <dt>Budget</dt>
                  <dd>{formatINR(r.budgetPaise)}</dd>
                  <dt>Food</dt>
                  <dd>{label(r.foodPreference)}</dd>
                  <dt>Needs</dt>
                  <dd>{r.categories.map((c) => c.name).join(', ')}</dd>
                  <dt>Customer</dt>
                  <dd>{d.customerFirstName}</dd>
                  <dt>Reference</dt>
                  <dd>{r.reference}</dd>
                </dl>
                {r.notes && (
                  <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
                    <strong>Notes: </strong>
                    {r.notes}
                  </p>
                )}
              </section>
              {(d.status === 'REQUESTED' || d.status === 'VENDOR_REVIEWING') && (
                <Button variant="danger" onClick={() => setClosing('decline')}>
                  Can&apos;t take this event
                </Button>
              )}
              {(d.status === 'QUOTED' || d.status === 'REVISED') && (
                <Button variant="danger" onClick={() => setClosing('withdraw')}>
                  Withdraw quote
                </Button>
              )}
            </aside>
            <Dialog open={closing !== null} onClose={() => setClosing(null)} title={closing === 'decline' ? 'Decline this request?' : 'Withdraw your quote?'}>
              <div className="stack">
                <TextArea label="Message to the customer (optional)" placeholder="e.g. Fully booked that weekend" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                <ErrorBox error={close.error} />
                <div className="row">
                  <Button
                    variant="danger"
                    loading={close.pending}
                    onClick={async () => {
                      const n = await close.run(closing!, reason);
                      if (n) {
                        q.setData(n);
                        setClosing(null);
                      }
                    }}
                  >
                    {closing === 'decline' ? 'Decline request' : 'Withdraw quote'}
                  </Button>
                  <Button variant="secondary" onClick={() => setClosing(null)}>
                    Back
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

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell title="Event request" intro={<Link href="/quotes">Back to requests</Link>}>
      <QuoteView id={id} />
    </Shell>
  );
}
