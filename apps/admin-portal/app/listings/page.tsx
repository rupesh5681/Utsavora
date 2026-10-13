'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Async, Button, DemoTag, Empty, ErrorBox, label, Pager, priceText, StatusBadge, TextInput, useAction, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';
import { StatusTabs } from '@/components/status-filter';

interface Row {
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
  status: string;
  isDemo: boolean;
  vendor: { id: string; businessName: string; status: string };
  category: { id: string; name: string };
}

function Card({ l, onDone }: { l: Row; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const act = useAction((api, decision: string) => api.post(`/admin/listings/${l.id}/decision`, { decision, notes }));
  const go = async (d: string) => { if (await act.run(d)) onDone(); };
  return (
    <article className="panel stack">
      <div className="row-between">
        <div>
          <h3 style={{ margin: 0 }}>{l.title} <DemoTag show={l.isDemo} /></h3>
          <div className="small muted">
            {l.vendor.businessName} {l.vendor.status !== 'APPROVED' && <StatusBadge status={l.vendor.status} text={`Vendor ${label(l.vendor.status).toLowerCase()}`} />}
          </div>
        </div>
        <StatusBadge status={l.status} />
      </div>
      <dl className="kv">
        <dt>Category</dt><dd>{l.category.name}, {label(l.type).toLowerCase()}</dd>
        <dt>Price</dt><dd>{priceText(l)}</dd>
        {(l.minGuests || l.maxGuests) && (<><dt>Guests</dt><dd>{l.minGuests ?? 1} to {l.maxGuests ?? 'any'}</dd></>)}
        <dt>Food</dt><dd>{label(l.foodPreference)}</dd>
      </dl>
      <p className="small" style={{ margin: 0 }}>{l.description}</p>
      {l.inclusions.length > 0 && <ul className="small" style={{ margin: 0 }}>{l.inclusions.map((i) => <li key={i}>{i}</li>)}</ul>}
      {['PENDING_REVIEW', 'APPROVED', 'SUSPENDED'].includes(l.status) && (
        <>
          <TextInput label="Notes for the vendor" hint="Required to reject or suspend" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <ErrorBox error={act.error} />
          <div className="row">
            {l.status !== 'APPROVED' && <Button variant="peacock" size="sm" loading={act.pending} onClick={() => go('approve')}>{l.status === 'SUSPENDED' ? 'Reinstate' : 'Approve'}</Button>}
            {l.status === 'PENDING_REVIEW' && <Button variant="danger" size="sm" loading={act.pending} onClick={() => go('reject')}>Reject</Button>}
            {l.status === 'APPROVED' && <Button variant="danger" size="sm" loading={act.pending} onClick={() => go('suspend')}>Suspend</Button>}
          </div>
        </>
      )}
    </article>
  );
}

function Queue() {
  const status = useSearchParams().get('status') ?? 'PENDING_REVIEW';
  const [page, setPage] = useState(1);
  const q = useQuery(`alistings:${status}:${page}`, (api) => api.getPage<Row>('/admin/listings', { status: status || undefined, page }));
  return (
    <>
      <StatusTabs statuses={['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT']} fallback="PENDING_REVIEW" />
      <Async state={q}>
        {(p) =>
          p.data.length === 0 ? (
            <Empty title="Nothing to review">New and edited menus and packages arrive here.</Empty>
          ) : (
            <>
              <div className="grid-2">{p.data.map((l) => <Card key={l.id} l={l} onDone={() => void q.reload()} />)}</div>
              <Pager meta={p.meta} onPage={setPage} />
            </>
          )
        }
      </Async>
    </>
  );
}

export default function ListingsPage() {
  return (
    <Shell title="Listing moderation" intro="Menus, packages and services go live only after approval. Edits to approved listings come back here.">
      <Queue />
    </Shell>
  );
}
