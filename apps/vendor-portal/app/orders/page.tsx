'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { OrderSummary } from '@utsavora/api-client';
import { Async, DemoTag, Empty, formatDate, Money, Pager, SelectInput, StatusBadge, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

const STATUSES = ['PENDING_CONFIRMATION', 'PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => ({
  value: s,
  label: { PENDING_CONFIRMATION: 'Needs your confirmation', PAYMENT_PENDING: 'Advance pending', CONFIRMED: 'Confirmed', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }[s]!,
}));

function Orders() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const q = useQuery(`vorders:${page}:${status}`, (api) => api.getPage<OrderSummary>('/orders', { page, status: status || undefined }));
  return (
    <div className="stack">
      <div style={{ maxWidth: 280 }}>
        <SelectInput label="Show" placeholder="All bookings" options={STATUSES} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
      </div>
      <Async state={q}>
        {(p) =>
          p.data.length === 0 ? (
            <Empty title="No bookings here">When a customer accepts your quote, the booking appears here for you to confirm.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Event date</th>
                      <th>Customer</th>
                      <th className="right">Total</th>
                      <th className="right">Your payout</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.data.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/orders/${o.id}`}>{o.orderNumber}</Link> <DemoTag show={o.isDemo} />
                          <div className="xsmall muted">
                            {o.occasion}, {o.area}, {o.guestCount} guests
                          </div>
                        </td>
                        <td className="nowrap">{formatDate(o.eventDate)}</td>
                        <td>{o.customer.name}</td>
                        <td className="right"><Money paise={o.totalPaise} /></td>
                        <td className="right"><Money paise={o.vendorPayablePaise} /></td>
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
    <Shell title="Bookings" intro="Sorted by event date. Confirm new bookings quickly so customers can pay the advance.">
      <Orders />
    </Shell>
  );
}
