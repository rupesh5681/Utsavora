'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { OrderSummary } from '@utsavora/api-client';
import { Async, Button, DemoTag, Empty, ErrorBox, formatDate, Money, Pager, SelectInput, StatusBadge, TextInput, useApi, useQuery, ApiError } from '@utsavora/ui';
import { Shell } from '@/components/shell';

const STATUSES = ['PENDING_CONFIRMATION', 'PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function Queue() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const api = useApi();
  const f = { status: params.get('status') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '', q: params.get('q') ?? '' };
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(f.q);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<ApiError | null>(null);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v); else p.delete(k);
    setPage(1);
    router.replace(`${path}?${p.toString()}`);
  };
  const q = useQuery(`aorders:${params.toString()}:${page}`, (a) => a.getPage<OrderSummary>('/admin/orders', { ...f, page }));

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      // The admin session is selected by header, so download via fetch rather than a plain link.
      const res = await fetch(api.url('/admin/orders/export.csv', { status: f.status, from: f.from, to: f.to, q: f.q }), { headers: { 'x-utsavora-app': 'admin' } });
      if (!res.ok) throw new ApiError(res.status, 'EXPORT_FAILED', 'Export failed. Check your permissions and try again.');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'utsavora-bookings.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof ApiError ? e : new ApiError(0, 'EXPORT_FAILED', 'Export failed.'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' }}>
        <SelectInput label="Status" placeholder="Any status" options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} value={f.status} onChange={(e) => set('status', e.target.value)} />
        <TextInput label="Event from" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
        <TextInput label="Event to" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
        <form onSubmit={(e) => { e.preventDefault(); set('q', search.trim()); }}>
          <TextInput label="Search" type="search" placeholder="Booking no., vendor, customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Button variant="secondary" loading={exporting} onClick={exportCsv}>Export CSV</Button>
      </div>
      <ErrorBox error={exportError} />
      <Async state={q}>
        {(p) =>
          p.data.length === 0 ? <Empty title="No bookings match" /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Booking</th><th>Event date</th><th>Customer</th><th>Vendor</th><th className="right">Total</th><th className="right">Paid</th><th className="right">Commission</th><th>Status</th></tr></thead>
                  <tbody>
                    {p.data.map((o) => (
                      <tr key={o.id}>
                        <td><Link href={`/orders/${o.id}`}>{o.orderNumber}</Link> <DemoTag show={o.isDemo} /><div className="xsmall muted">{o.occasion}, {o.area}</div></td>
                        <td className="nowrap">{formatDate(o.eventDate)}</td>
                        <td>{o.customer.name}</td>
                        <td>{o.vendor.businessName}</td>
                        <td className="right"><Money paise={o.totalPaise} /></td>
                        <td className="right"><Money paise={o.paidPaise} /></td>
                        <td className="right"><Money paise={o.commissionPaise} /></td>
                        <td><StatusBadge status={o.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager meta={p.meta} onPage={setPage} />
            </>
          )
        }
      </Async>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Shell title="Booking queue" intro="All bookings by event date. Record verified payments from a booking's page.">
      <Queue />
    </Shell>
  );
}
