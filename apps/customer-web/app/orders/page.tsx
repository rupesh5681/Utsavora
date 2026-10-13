'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { OrderSummary } from '@utsavora/api-client';
import { Async, ButtonLink, DemoTag, Empty, formatDate, Money, Pager, RequireAuth, StatusBadge, useQuery } from '@utsavora/ui';

function Orders() {
  const [page, setPage] = useState(1);
  const q = useQuery(`orders:${page}`, (api) => api.getPage<OrderSummary>('/orders', { page }));
  return (
    <Async state={q}>
      {(p) =>
        p.data.length === 0 ? (
          <Empty title="No bookings yet" action={<ButtonLink href="/requests">See my requests</ButtonLink>}>
            When you accept a quote, the booking appears here so you can track it.
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>Event date</th>
                    <th>Vendor</th>
                    <th className="right">Total</th>
                    <th className="right">Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.data.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/orders/${o.id}`}>{o.orderNumber}</Link> <DemoTag show={o.isDemo} />
                        <div className="xsmall muted">
                          {o.occasion}, {o.area}
                        </div>
                      </td>
                      <td className="nowrap">{formatDate(o.eventDate)}</td>
                      <td>{o.vendor.businessName}</td>
                      <td className="right">
                        <Money paise={o.totalPaise} />
                      </td>
                      <td className="right">
                        <Money paise={o.paidPaise} />
                      </td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
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
  );
}

export default function OrdersPage() {
  return (
    <div className="container page">
      <div className="page-head">
        <h1>Bookings</h1>
      </div>
      <RequireAuth>
        <Orders />
      </RequireAuth>
    </div>
  );
}
