'use client';
import Link from 'next/link';
import { Async, formatINR, label, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

interface Dash {
  vendorsPending: number;
  vendorsApproved: number;
  listingsPending: number;
  openRequests: number;
  requestsWithoutQuotes24h: number;
  upcomingEvents7d: number;
  ordersByStatus: Record<string, number>;
  bookedPaise: number;
  commissionPaise: number;
  collectedPaise: number;
  note: string;
}

function Stat({ v, k, href, attn }: { v: string | number; k: string; href?: string; attn?: boolean }) {
  const inner = (
    <>
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </>
  );
  return href ? <Link href={href} className={`stat ${attn ? 'stat-attn' : ''}`}>{inner}</Link> : <div className={`stat ${attn ? 'stat-attn' : ''}`}>{inner}</div>;
}

export default function Dashboard() {
  const q = useQuery('admin-dash', (api) => api.get<Dash>('/admin/dashboard'));
  return (
    <Shell title="Dashboard" intro="Live from the database.">
      <Async state={q}>
        {(d) => (
          <div className="stack-lg">
            <section>
              <h2 className="section-title">Needs attention</h2>
              <div className="stats">
                <Stat v={d.vendorsPending} k="Vendors awaiting verification" href="/vendors?status=PENDING_REVIEW" attn={d.vendorsPending > 0} />
                <Stat v={d.listingsPending} k="Listings awaiting review" href="/listings?status=PENDING_REVIEW" attn={d.listingsPending > 0} />
                <Stat v={d.requestsWithoutQuotes24h} k="Requests with no quote after 24h" href="/requests?status=OPEN" attn={d.requestsWithoutQuotes24h > 0} />
                <Stat v={d.ordersByStatus.PENDING_CONFIRMATION ?? 0} k="Bookings awaiting vendor" href="/orders?status=PENDING_CONFIRMATION" />
                <Stat v={d.ordersByStatus.PAYMENT_PENDING ?? 0} k="Advances to collect" href="/orders?status=PAYMENT_PENDING" attn={(d.ordersByStatus.PAYMENT_PENDING ?? 0) > 0} />
              </div>
            </section>
            <section>
              <h2 className="section-title">Marketplace</h2>
              <div className="stats">
                <Stat v={d.vendorsApproved} k="Approved vendors" />
                <Stat v={d.openRequests} k="Open event requests" href="/requests?status=OPEN" />
                <Stat v={d.upcomingEvents7d} k="Events in the next 7 days" href="/orders" />
                <Stat v={formatINR(d.bookedPaise)} k="Confirmed booking value" />
                <Stat v={formatINR(d.commissionPaise)} k="Commission on confirmed bookings" />
                <Stat v={formatINR(d.collectedPaise)} k="Payments recorded" />
              </div>
              <p className="xsmall muted" style={{ marginTop: 8 }}>{d.note}</p>
            </section>
            <section>
              <h2 className="section-title">Bookings by status</h2>
              <div className="stats">
                {Object.entries(d.ordersByStatus).map(([s, n]) => (
                  <Stat key={s} v={n} k={label(s)} href={`/orders?status=${s}`} />
                ))}
              </div>
            </section>
          </div>
        )}
      </Async>
    </Shell>
  );
}
