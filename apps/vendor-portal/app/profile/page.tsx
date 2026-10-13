'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { VendorProfileSchema } from '@utsavora/validation';
import type { VendorSelf } from '@utsavora/api-client';
import { Async, Button, Chips, ErrorBox, Notice, StatusBadge, TextArea, TextInput, useAction, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';
import { StatusBanner } from '@/components/status-banner';
import { useRefData } from '@/components/ref-data';

function ProfileForm({ v, onSaved }: { v: VendorSelf; onSaved: (v: VendorSelf) => void }) {
  const ref = useRefData();
  const welcome = useSearchParams().get('welcome');
  const [f, setF] = useState({
    businessName: v.businessName,
    description: v.description,
    phone: v.phone,
    city: v.city,
    addressLine: v.addressLine,
    gstin: v.gstin ?? '',
    fssaiNumber: v.fssaiNumber ?? '',
    maxEventsPerDay: String(v.maxEventsPerDay),
    categoryIds: v.categoryIds,
    serviceAreaIds: v.serviceAreaIds,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = useAction((api, body: unknown) => api.put<VendorSelf>('/vendor/me', body));
  const submit = useAction((api) => api.post<VendorSelf>('/vendor/me/submit'));
  useEffect(() => {
    if (save.error) setErrors(save.error.fieldErrors);
  }, [save.error]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const needsFssai = (ref.data?.categories ?? []).some((c) => c.requiresFssai && f.categoryIds.includes(c.id));
  const locked = v.status === 'SUSPENDED';

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const p = VendorProfileSchema.safeParse({ ...f, maxEventsPerDay: Number(f.maxEventsPerDay) });
    if (!p.success) {
      const errs: Record<string, string> = {};
      for (const i of p.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setErrors({});
    const r = await save.run(p.data);
    if (r) {
      onSaved(r);
      setSaved(true);
    }
  }

  return (
    <div className="split">
      <form className="stack-lg" onSubmit={onSave} noValidate>
        {welcome && <Notice tone="success">Account created. Tell customers about your business, then submit it for verification.</Notice>}
        <StatusBanner v={v} />
        <div className="form-grid">
          <TextInput label="Business name" value={f.businessName} onChange={set('businessName')} error={errors.businessName} />
          <TextInput label="Business phone" prefix="+91" inputMode="numeric" value={f.phone} onChange={set('phone')} error={errors.phone} />
          <TextArea
            className="span-2"
            label="About your business"
            hint="What you specialise in, years of experience, typical event size. At least 50 characters."
            value={f.description}
            maxLength={3000}
            onChange={set('description')}
            error={errors.description}
          />
          <TextInput label="City" value={f.city} onChange={set('city')} error={errors.city} />
          <TextInput label="Kitchen or office address" hint="Optional, for verification only" value={f.addressLine} onChange={set('addressLine')} />
          <TextInput
            label="FSSAI licence number"
            hint={needsFssai ? 'Required for catering and cakes' : 'Needed only for food categories'}
            inputMode="numeric"
            value={f.fssaiNumber}
            onChange={set('fssaiNumber')}
            error={errors.fssaiNumber}
          />
          <TextInput label="GSTIN" hint="Optional" value={f.gstin} onChange={set('gstin')} error={errors.gstin} />
          <TextInput
            label="Events you can serve per day"
            type="number"
            min={1}
            max={50}
            hint="We stop accepting bookings on a date once you reach this."
            value={f.maxEventsPerDay}
            onChange={set('maxEventsPerDay')}
            error={errors.maxEventsPerDay}
          />
        </div>
        {ref.data && (
          <>
            <Chips
              legend="Services you offer"
              options={ref.data.categories.map((c) => ({ value: c.id, label: c.name }))}
              value={f.categoryIds}
              onChange={(x) => setF((s) => ({ ...s, categoryIds: x }))}
              error={errors.categoryIds}
            />
            <Chips
              legend="Areas you serve"
              options={ref.data.areas.map((a) => ({ value: a.id, label: a.name }))}
              value={f.serviceAreaIds}
              onChange={(x) => setF((s) => ({ ...s, serviceAreaIds: x }))}
              error={errors.serviceAreaIds}
            />
          </>
        )}
        <ErrorBox error={save.error && !Object.keys(save.error.fieldErrors).length ? save.error : null} />
        {saved && <Notice tone="success">Profile saved.</Notice>}
        <div>
          <Button type="submit" loading={save.pending} disabled={locked}>
            Save profile
          </Button>
        </div>
      </form>
      <aside className="panel stack">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>Verification</h3>
          <StatusBadge status={v.status} />
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack small">
          {v.checklist.map((c) => (
            <li key={c.key} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span aria-hidden style={{ color: c.done ? 'var(--leaf)' : 'var(--ink-faint)', fontWeight: 700 }}>
                {c.done ? '✓' : '○'}
              </span>
              <span>
                {c.label}
                <span className="sr-only">{c.done ? ' (done)' : ' (to do)'}</span>
              </span>
            </li>
          ))}
        </ul>
        {(v.status === 'DRAFT' || v.status === 'REJECTED') && (
          <>
            <p className="small muted" style={{ margin: 0 }}>Save your changes first, then submit. The Utsavora team checks your details before customers can see you.</p>
            <ErrorBox error={submit.error} />
            <Button
              variant="peacock"
              loading={submit.pending}
              disabled={!v.checklist.every((c) => c.done)}
              onClick={async () => {
                const r = await submit.run();
                if (r) onSaved(r);
              }}
            >
              Submit for verification
            </Button>
          </>
        )}
      </aside>
    </div>
  );
}

export default function ProfilePage() {
  const q = useQuery('vendor-me', (api) => api.get<VendorSelf>('/vendor/me'));
  return (
    <Shell title="Business profile" intro="Customers see your name, description, services and areas once you're verified.">
      <Async state={q} lines={8}>
        {(v) => <ProfileForm v={v} onSaved={q.setData} />}
      </Async>
    </Shell>
  );
}
