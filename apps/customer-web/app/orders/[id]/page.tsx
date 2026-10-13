'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type { OrderDetail } from '@utsavora/api-client';
import { Async, formatINR, Notice, OrderView, RequireAuth, useQuery } from '@utsavora/ui';

function Order({ id }: { id: string }) {
  const isNew = useSearchParams().get('new') === '1';
  const q = useQuery(`order:${id}`, (api) => api.get<OrderDetail>(`/orders/${id}`));
  return (
    <Async state={q} lines={8}>
      {(o) => (
        <div className="stack-lg">
          <div>
            <p className="small muted" style={{ margin: 0 }}>
              <Link href="/orders">Bookings</Link> / {o.orderNumber}
            </p>
            <h1 style={{ fontSize: 'var(--t-2xl)' }}>
              {o.snapshot.event.occasion} with {o.vendor.businessName}
            </h1>
          </div>
          {isNew && o.status === 'PENDING_CONFIRMATION' && (
            <Notice tone="success">Booking created. {o.vendor.businessName} has been asked to confirm; we&apos;ll notify you here and by your updates page.</Notice>
          )}
          <OrderView
            order={o}
            viewer="customer"
            onChange={q.setData}
            paymentNote={
              <Notice tone="warn">
                <p>
                  {o.vendor.businessName} confirmed. Pay the advance of <strong>{formatINR(o.advancePaise - o.paidPaise > 0 ? o.advancePaise - o.paidPaise : 0)}</strong> to lock the
                  date. The Utsavora team will call you with verified UPI or bank details. Online payment is coming soon; please don&apos;t pay anyone who
                  contacts you outside Utsavora.
                </p>
              </Notice>
            }
          />
        </div>
      )}
    </Async>
  );
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="container page">
      <RequireAuth>
        <Order id={id} />
      </RequireAuth>
    </div>
  );
}
