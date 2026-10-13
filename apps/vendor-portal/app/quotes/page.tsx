'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { VendorInboxItem } from '@utsavora/api-client';
import { Async, Empty, formatDate, label, Money, Pager, StatusBadge, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

const TABS = [
  { key: 'new', text: 'New' },
  { key: 'quoted', text: 'Quoted' },
  { key: 'won', text: 'Won' },
  { key: 'closed', text: 'Closed' },
  { key: '', text: 'All' },
];

function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const status = params.get('status') ?? 'new';
  const page = Number(params.get('page') ?? 1);
  const q = useQuery(`inbox:${status}:${page}`, (api) => api.getPage<VendorInboxItem>('/vendor/quotes', { status: status || undefined, page }));
  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <Link key={t.key} href={`${path}?status=${t.key}`} aria-current={status === t.key ? 'page' : undefined}>
            {t.text}
          </Link>
        ))}
      </div>
      <Async state={q}>
        {(p) =>
          p.data.length === 0 ? (
            <Empty title={status === 'new' ? 'No new requests' : 'Nothing here'}>
              {status === 'new' ? 'When a customer in your areas asks for your services, the request appears here.' : 'Try another tab.'}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Date</th>
                      <th>Guests</th>
                      <th className="right">Budget</th>
                      <th className="right">Your quote</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.data.map((x) => (
                      <tr key={x.id} className="clickable" onClick={() => router.push(`/quotes/${x.id}`)}>
                        <td>
                          <Link href={`/quotes/${x.id}`} onClick={(e) => e.stopPropagation()}>
                            {x.request.occasion} in {x.request.area.split(',')[0]}
                          </Link>
                          <div className="xsmall muted">
                            {x.request.reference}, {x.request.categories.map((c) => c.name).join(', ')}, {label(x.request.foodPreference)}
                          </div>
                        </td>
                        <td className="nowrap">{formatDate(x.request.eventDate)}</td>
                        <td className="num">{x.request.guestCount}</td>
                        <td className="right">
                          <Money paise={x.request.budgetPaise} />
                        </td>
                        <td className="right">{x.latest ? <Money paise={x.latest.totalPaise} /> : <span className="muted">—</span>}</td>
                        <td>
                          <StatusBadge status={x.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager meta={p.meta} onPage={(n) => router.replace(`${path}?status=${status}&page=${n}`)} />
            </>
          )
        }
      </Async>
    </>
  );
}

export default function QuotesPage() {
  return (
    <Shell title="Requests & quotes" intro="Customers' contact details are shared once they book you.">
      <Inbox />
    </Shell>
  );
}
