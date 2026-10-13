'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Async, DemoTag, Empty, formatDate, Pager, StatusBadge, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';
import { StatusTabs } from '@/components/status-filter';

interface Row { id: string; businessName: string; status: string; city: string; phone: string; isDemo: boolean; submittedAt: string | null; createdAt: string }

function Vendors() {
  const status = useSearchParams().get('status') ?? 'PENDING_REVIEW';
  const [page, setPage] = useState(1);
  const q = useQuery(`avendors:${status}:${page}`, (api) => api.getPage<Row>('/admin/vendors', { status: status || undefined, page }));
  return (
    <>
      <StatusTabs statuses={['PENDING_REVIEW', 'APPROVED', 'DRAFT', 'REJECTED', 'SUSPENDED']} fallback="PENDING_REVIEW" />
      <Async state={q}>
        {(p) =>
          p.data.length === 0 ? (
            <Empty title="No vendors in this state" />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Business</th><th>Phone</th><th>Submitted</th><th>Joined</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {p.data.map((v) => (
                      <tr key={v.id}>
                        <td><Link href={`/vendors/${v.id}`}>{v.businessName}</Link> <DemoTag show={v.isDemo} /><div className="xsmall muted">{v.city}</div></td>
                        <td>+91 {v.phone}</td>
                        <td className="nowrap">{v.submittedAt ? formatDate(v.submittedAt, 'short') : '—'}</td>
                        <td className="nowrap">{formatDate(v.createdAt, 'short')}</td>
                        <td><StatusBadge status={v.status} /></td>
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

export default function VendorsPage() {
  return (
    <Shell title="Vendors" intro="Verify businesses before customers can see them or receive their quotes.">
      <Vendors />
    </Shell>
  );
}
