'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RecordPaymentSchema } from '@utsavora/validation';
import type { OrderDetail } from '@utsavora/api-client';
import { Async, Button, ErrorBox, formatINR, Notice, OrderView, rupeesToPaise, SelectInput, TextInput, todayISO, useAction, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

const METHODS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer (NEFT/IMPS/RTGS)' },
  { value: 'CHEQUE', label: 'Cheque (cleared)' },
  { value: 'CASH', label: 'Cash' },
];

function PaymentForm({ o, onDone }: { o: OrderDetail; onDone: (o: OrderDetail) => void }) {
  const dueAdvance = Math.max(o.advancePaise - o.paidPaise, 0);
  const [f, setF] = useState({ amount: String((dueAdvance || o.balancePaise) / 100), method: 'UPI', reference: '', receivedOn: todayISO(), notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pay = useAction((api, body: unknown) => api.post<OrderDetail>(`/admin/orders/${o.id}/payments`, body));
  useEffect(() => { if (pay.error) setErrors(pay.error.fieldErrors); }, [pay.error]);
  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Record a verified payment</h3>
      <p className="xsmall muted" style={{ margin: 0 }}>
        Only record money you have confirmed in the bank statement or UPI app. Outstanding: {formatINR(o.balancePaise)}{dueAdvance > 0 ? `, advance still due ${formatINR(dueAdvance)}` : ''}.
      </p>
      <TextInput label="Amount" prefix="₹" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} error={errors.amountPaise} />
      <SelectInput label="Method" options={METHODS} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} />
      <TextInput label="Transaction reference" hint="UTR, UPI reference or cheque number" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} error={errors.reference} />
      <TextInput label="Received on" type="date" max={todayISO()} value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} error={errors.receivedOn} />
      <ErrorBox error={pay.error && !Object.keys(pay.error.fieldErrors).length ? pay.error : null} />
      <Button
        variant="peacock"
        loading={pay.pending}
        onClick={async () => {
          const p = RecordPaymentSchema.safeParse({ amountPaise: rupeesToPaise(f.amount), method: f.method, reference: f.reference, receivedOn: f.receivedOn, notes: f.notes });
          if (!p.success) {
            const errs: Record<string, string> = {};
            for (const i of p.error.issues) errs[String(i.path[0])] ??= i.message;
            return setErrors(errs);
          }
          setErrors({});
          const r = await pay.run(p.data);
          if (r) { onDone(r); setF({ ...f, reference: '', amount: String(r.balancePaise / 100) }); }
        }}
      >
        Record payment
      </Button>
    </section>
  );
}

function Order({ id }: { id: string }) {
  const q = useQuery(`aorder:${id}`, (api) => api.get<OrderDetail>(`/orders/${id}`));
  return (
    <Async state={q} lines={8}>
      {(o) => (
        <div className="stack-lg">
          <h2 style={{ margin: 0 }}>{o.orderNumber}</h2>
          <OrderView
            order={o}
            viewer="admin"
            onChange={q.setData}
            paymentNote={<Notice tone="warn">Advance pending. Call the customer with verified payment details, then record the payment here.</Notice>}
            aside={o.canRecordPayment ? <PaymentForm o={o} onDone={q.setData} /> : null}
          />
        </div>
      )}
    </Async>
  );
}

export default function AdminOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell title="Booking" intro={<Link href="/orders">Back to booking queue</Link>}>
      <Order id={id} />
    </Shell>
  );
}
