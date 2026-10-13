'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { OrderDetail } from '@utsavora/api-client';
import { Async, Notice, OrderView, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

function Order({ id }: { id: string }) {
  const q = useQuery(`vorder:${id}`, (api) => api.get<OrderDetail>(`/orders/${id}`));
  return (
    <Async state={q} lines={8}>
      {(o) => (
        <div className="stack-lg">
          <h2 style={{ margin: 0 }}>
            {o.orderNumber}: {o.snapshot.event.occasion} for {o.customer.name}
          </h2>
          <OrderView
            order={o}
            viewer="vendor"
            onChange={q.setData}
            paymentNote={<Notice tone="info">Waiting for the customer&apos;s advance. Utsavora records verified payments and will notify you; please don&apos;t collect payments outside Utsavora.</Notice>}
          />
        </div>
      )}
    </Async>
  );
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell title="Booking" intro={<Link href="/orders">Back to bookings</Link>}>
      <Order id={id} />
    </Shell>
  );
}
