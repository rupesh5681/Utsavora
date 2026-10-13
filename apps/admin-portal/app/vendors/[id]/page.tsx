'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { ChecklistItem } from '@utsavora/api-client';
import { Async, Button, DemoTag, ErrorBox, formatDateTime, label, StatusBadge, TextArea, useAction, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

interface VendorAdmin {
  id: string;
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
  categories: { id: string; name: string }[];
  serviceAreas: { id: string; name: string }[];
  members: { id: string; name: string; email: string; phone: string; role: string }[];
  reviews: { id: string; decision: string; fromStatus: string; toStatus: string; notes: string; reviewer: string; createdAt: string }[];
  listings: { id: string; title: string; status: string; type: string }[];
  checklist: ChecklistItem[];
}

const DECISIONS: Record<string, { decision: 'approve' | 'reject' | 'suspend'; text: string; variant: 'primary' | 'danger' | 'peacock' }[]> = {
  PENDING_REVIEW: [
    { decision: 'approve', text: 'Approve vendor', variant: 'peacock' },
    { decision: 'reject', text: 'Send back with changes', variant: 'danger' },
  ],
  APPROVED: [{ decision: 'suspend', text: 'Suspend vendor', variant: 'danger' }],
  SUSPENDED: [{ decision: 'approve', text: 'Reinstate vendor', variant: 'peacock' }],
};

function Vendor({ id }: { id: string }) {
  const q = useQuery(`avendor:${id}`, (api) => api.get<VendorAdmin>(`/admin/vendors/${id}`));
  const [notes, setNotes] = useState('');
  const decide = useAction((api, decision: string) => api.post<VendorAdmin>(`/admin/vendors/${id}/decision`, { decision, notes }));
  return (
    <Async state={q} lines={8}>
      {(v) => (
        <div className="split">
          <div className="stack-lg">
            <div className="row">
              <h2 style={{ margin: 0 }}>{v.businessName}</h2>
              <StatusBadge status={v.status} />
              <DemoTag show={v.isDemo} />
            </div>
            <p>{v.description || <span className="muted">No description yet.</span>}</p>
            <dl className="kv panel">
              <dt>Phone</dt><dd>+91 {v.phone}</dd>
              <dt>City</dt><dd>{v.city}</dd>
              <dt>Address</dt><dd>{v.addressLine || '—'}</dd>
              <dt>FSSAI</dt><dd>{v.fssaiNumber ?? '—'}</dd>
              <dt>GSTIN</dt><dd>{v.gstin ?? '—'}</dd>
              <dt>Capacity</dt><dd>{v.maxEventsPerDay} events per day</dd>
              <dt>Services</dt><dd>{v.categories.map((c) => c.name).join(', ') || '—'}</dd>
              <dt>Areas</dt><dd>{v.serviceAreas.map((a) => a.name).join(', ') || '—'}</dd>
              <dt>Team</dt><dd>{v.members.map((m) => `${m.name} (${m.email}, +91 ${m.phone})`).join('; ')}</dd>
            </dl>
            <section>
              <h3>Listings</h3>
              {v.listings.length ? (
                <ul className="small">
                  {v.listings.map((l) => (
                    <li key={l.id}>{l.title}, {label(l.type).toLowerCase()} <StatusBadge status={l.status} /></li>
                  ))}
                </ul>
              ) : <p className="muted small">None yet.</p>}
            </section>
            <section>
              <h3>Review history</h3>
              {v.reviews.length ? (
                <ul className="small">
                  {v.reviews.map((r) => (
                    <li key={r.id}>{formatDateTime(r.createdAt)}: {r.reviewer} chose {r.decision} ({label(r.fromStatus)} to {label(r.toStatus)}){r.notes ? `: ${r.notes}` : ''}</li>
                  ))}
                </ul>
              ) : <p className="muted small">Not reviewed yet.</p>}
            </section>
          </div>
          <aside className="panel stack">
            <h3 style={{ margin: 0 }}>Onboarding checks</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="small stack" >
              {v.checklist.map((c) => (
                <li key={c.key}><span aria-hidden style={{ color: c.done ? 'var(--leaf)' : 'var(--danger)', fontWeight: 700 }}>{c.done ? '✓' : '✗'}</span> {c.label}<span className="sr-only">{c.done ? ' passed' : ' missing'}</span></li>
              ))}
            </ul>
            <p className="xsmall muted" style={{ margin: 0 }}>Verify the FSSAI number on foscos.fssai.gov.in and the GSTIN on the GST portal before approving.</p>
            {DECISIONS[v.status] ? (
              <>
                <TextArea label="Notes for the vendor" hint="Required when sending back or suspending" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
                <ErrorBox error={decide.error} />
                <div className="row">
                  {DECISIONS[v.status].map((d) => (
                    <Button key={d.decision} variant={d.variant} loading={decide.pending} onClick={async () => { const r = await decide.run(d.decision); if (r) { q.setData(r); setNotes(''); } }}>
                      {d.text}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>No decision available until the vendor submits their profile.</p>
            )}
          </aside>
        </div>
      )}
    </Async>
  );
}

export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell title="Vendor review" intro={<Link href="/vendors">Back to vendors</Link>}>
      <Vendor id={id} />
    </Shell>
  );
}
