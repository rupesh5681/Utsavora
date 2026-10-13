'use client';
import Link from 'next/link';
import type { VendorSelf } from '@utsavora/api-client';
import { Async, DemoTag, formatINR, StatusBadge, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';
import { StatusBanner } from '@/components/status-banner';

interface Dash {
  newRequests: number;
  awaitingCustomer: number;
  quotesWon: number;
  ordersToConfirm: number;
  upcomingEvents: number;
  bookedPaise: number;
  payablePaise: number;
}

function Overview() {
  const me = useQuery('vendor-me', (api) => api.get<VendorSelf>('/vendor/me'));
  const dash = useQuery('vendor-dash', (api) => api.get<Dash>('/vendor/dashboard'));
  return (
    <div className="stack-lg">
      <Async state={me} lines={2}>
        {(v) => (
          <div className="stack">
            <div className="row">
              <StatusBadge status={v.status} />
              <DemoTag show={v.isDemo} />
            </div>
            <StatusBanner v={v} />
          </div>
        )}
      </Async>
      <Async state={dash}>
        {(d) => (
          <div className="stats">
            <Link href="/quotes?status=new" className={`stat ${d.newRequests ? 'stat-attn' : ''}`}>
              <div className="v">{d.newRequests}</div>
              <div className="k">New requests to quote</div>
            </Link>
            <Link href="/orders" className={`stat ${d.ordersToConfirm ? 'stat-attn' : ''}`}>
              <div className="v">{d.ordersToConfirm}</div>
              <div className="k">Bookings to confirm</div>
            </Link>
            <Link href="/quotes?status=quoted" className="stat">
              <div className="v">{d.awaitingCustomer}</div>
              <div className="k">Quotes with customers</div>
            </Link>
            <Link href="/orders" className="stat">
              <div className="v">{d.upcomingEvents}</div>
              <div className="k">Upcoming events</div>
            </Link>
            <div className="stat">
              <div className="v">{formatINR(d.bookedPaise)}</div>
              <div className="k">Confirmed booking value</div>
            </div>
            <div className="stat">
              <div className="v">{formatINR(d.payablePaise)}</div>
              <div className="k">Your earnings after platform fee</div>
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}

export default function Page() {
  return (
    <Shell title="Overview">
      <Overview />
    </Shell>
  );
}
