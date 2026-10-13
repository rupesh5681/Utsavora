'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Async, Empty, formatDate, Money, Pager, StatusBadge, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';
import { StatusTabs } from '@/components/status-filter';

interface Row {
  id: string; reference: string; status: string; occasion: string; area: string; eventDate: string; guestCount: number; budgetPaise: number;
  customer: { name: string; email: string; phone: string }; vendorsInvited: number; quotesReceived: number; createdAt: string;
}

function Requests() {
  const status = useSearchParams().get('status') ?? 'OPEN';
  const [page, setPage] = useState(1);
  const q = useQuery(`areq:${status}:${page}`, (api) => api.getPage<Row>('/admin/requests', { status: status || undefined, page }));
  return (
    <>
      <StatusTabs statuses={['OPEN', 'ACCEPTED', 'CANCELLED', 'EXPIRED']} fallback="OPEN" />
      <Async state={q}>
        {(p) =>
          p.data.length === 0 ? <Empty title="No requests here" /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Request</th><th>Event date</th><th>Customer</th><th>Guests</th><th className="right">Budget</th><th>Vendors</th><th>Status</th></tr></thead>
                  <tbody>
                    {p.data.map((r) => (
                      <tr key={r.id}>
                        <td>{r.reference}<div className="xsmall muted">{r.occasion}, {r.area}, created {formatDate(r.createdAt, 'short')}</div></td>
                        <td className="nowrap">{formatDate(r.eventDate)}</td>
                        <td>{r.customer.name}<div className="xsmall muted">+91 {r.customer.phone}</div></td>
                        <td className="num">{r.guestCount}</td>
                        <td className="right"><Money paise={r.budgetPaise} /></td>
                        <td className="num" style={{ color: r.vendorsInvited === 0 ? 'var(--danger)' : undefined }}>
                          {r.vendorsInvited === 0 ? 'No match' : `${r.quotesReceived} quoted of ${r.vendorsInvited}`}
                        </td>
                        <td><StatusBadge status={r.status} /></td>
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
    </>
  );
}

export default function RequestsPage() {
  return (
    <Shell title="Event requests" intro="Follow up on requests with no matching vendors or no quotes.">
      <Requests />
    </Shell>
  );
}
