'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { EventRequestSchema } from '@utsavora/validation';
import { Button, Chips, ErrorBox, Loading, rupeesToPaise, SelectInput, TextArea, TextInput, todayISO, useAction, useMe } from '@utsavora/ui';
import { useRefData } from '@/components/ref-data';
import { BudgetPanel } from '@/components/budget-panel';

const DRAFT_KEY = 'utsavora:plan-draft';
const FOOD = [
  { value: 'VEG', label: 'Veg' },
  { value: 'JAIN', label: 'Jain' },
  { value: 'NON_VEG', label: 'Non-veg' },
  { value: 'MIXED', label: 'Veg + Non-veg' },
  { value: 'NOT_APPLICABLE', label: 'No food needed' },
];

interface Draft {
  occasionId: string;
  eventDate: string;
  eventTime: string;
  serviceAreaId: string;
  venueAddress: string;
  guestCount: string;
  budget: string;
  foodPreference: string;
  categoryIds: string[];
  notes: string;
  vendorId: string;
}

const empty: Draft = {
  occasionId: '',
  eventDate: '',
  eventTime: '',
  serviceAreaId: '',
  venueAddress: '',
  guestCount: '',
  budget: '',
  foodPreference: 'VEG',
  categoryIds: [],
  notes: '',
  vendorId: '',
};

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export default function PlanPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { me } = useMe();
  const ref = useRefData();
  const [f, setF] = useState<Draft>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useAction((a, body: unknown) => a.post<{ id: string; reference: string; matchedVendors: number }>('/requests', body));

  // Prefill: saved draft (after sign-in) wins, then query params from the home page or a listing.
  useEffect(() => {
    const d = readDraft();
    if (d) {
      setF(d);
      return;
    }
    setF((x) => ({
      ...x,
      occasionId: params.get('occasion') ?? '',
      eventDate: params.get('date') ?? '',
      guestCount: params.get('guests') ?? '',
      categoryIds: params.get('category') ? [params.get('category')!] : [],
      vendorId: params.get('vendor') ?? '',
    }));
  }, [params]);

  useEffect(() => {
    if (send.error) setErrors(send.error.fieldErrors);
  }, [send.error]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));
  const catSlugs = useMemo(
    () => (ref.data ? f.categoryIds.map((id) => ref.data!.categories.find((c) => c.id === id)?.slug).filter((s): s is string => Boolean(s)) : []),
    [ref.data, f.categoryIds],
  );

  function body() {
    return {
      occasionId: f.occasionId,
      eventDate: f.eventDate,
      eventTime: f.eventTime || undefined,
      serviceAreaId: f.serviceAreaId,
      venueAddress: f.venueAddress,
      guestCount: Number(f.guestCount),
      budgetPaise: rupeesToPaise(f.budget),
      foodPreference: f.foodPreference,
      categoryIds: f.categoryIds,
      notes: f.notes,
      vendorIds: f.vendorId ? [f.vendorId] : undefined,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = EventRequestSchema.safeParse(body());
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setErrors({});
    if (!me) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(f));
      router.push(`/register?next=${encodeURIComponent('/plan')}`);
      return;
    }
    const r = await send.run(parsed.data);
    if (r) {
      sessionStorage.removeItem(DRAFT_KEY);
      router.push(`/requests/${r.id}?sent=${r.matchedVendors}`);
    }
  }

  if (!ref.data) return <div className="container page"><Loading lines={8} /></div>;
  const d = ref.data;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Plan your event</h1>
          <p className="muted">One form, several quotes. Vendors see your event details but not your phone number until you book.</p>
        </div>
      </div>
      <form className="split" onSubmit={submit} noValidate>
        <div className="stack-lg">
          {f.vendorId && (
            <div className="alert">
              <p>
                This request will go only to the vendor you chose. <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('vendorId', '')}>Send to all matching vendors instead</button>
              </p>
            </div>
          )}
          <Chips
            legend="Occasion"
            multiple={false}
            options={d.occasions.map((o) => ({ value: o.id, label: o.name }))}
            value={f.occasionId ? [f.occasionId] : []}
            onChange={(v) => set('occasionId', v[0] ?? '')}
            error={errors.occasionId && 'Choose an occasion'}
          />
          <div className="form-grid">
            <TextInput label="Event date" type="date" min={todayISO(1)} value={f.eventDate} onChange={(e) => set('eventDate', e.target.value)} error={errors.eventDate} />
            <TextInput label="Start time" hint="Optional" type="time" value={f.eventTime} onChange={(e) => set('eventTime', e.target.value)} error={errors.eventTime} />
            <SelectInput
              label="Area"
              placeholder="Choose your area"
              value={f.serviceAreaId}
              onChange={(e) => set('serviceAreaId', e.target.value)}
              options={d.areas.map((a) => ({ value: a.id, label: `${a.name}, ${a.city}` }))}
              error={errors.serviceAreaId && 'Choose the area of your venue'}
            />
            <TextInput
              label="Venue or address"
              hint="Optional. Shared with vendors only after you book."
              placeholder="Society, banquet hall or farmhouse"
              value={f.venueAddress}
              onChange={(e) => set('venueAddress', e.target.value)}
            />
            <TextInput
              label="Guests"
              type="number"
              inputMode="numeric"
              min={1}
              value={f.guestCount}
              onChange={(e) => set('guestCount', e.target.value)}
              error={errors.guestCount}
            />
            <TextInput
              label="Total budget"
              prefix="₹"
              inputMode="numeric"
              placeholder="e.g. 75000"
              value={f.budget}
              onChange={(e) => set('budget', e.target.value.replace(/[^\d]/g, ''))}
              error={errors.budgetPaise}
            />
          </div>
          <Chips
            legend="Services you need"
            options={d.categories.map((c) => ({ value: c.id, label: c.name }))}
            value={f.categoryIds}
            onChange={(v) => set('categoryIds', v)}
            error={errors.categoryIds}
          />
          <Chips legend="Food preference" multiple={false} options={FOOD} value={[f.foodPreference]} onChange={(v) => set('foodPreference', v[0])} />
          <TextArea
            label="Anything vendors should know?"
            hint="Theme, must-have dishes, Jain cooking, setup timing, parking…"
            maxLength={2000}
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
          <ErrorBox error={send.error && !Object.keys(send.error.fieldErrors).length ? send.error : null} />
          <div className="row">
            <Button type="submit" loading={send.pending}>
              {me ? 'Send to vendors' : 'Continue to create account'}
            </Button>
            {!me && (
              <span className="small muted">
                Already have an account? <Link href="/login?next=/plan" onClick={() => sessionStorage.setItem(DRAFT_KEY, JSON.stringify(f))}>Sign in</Link>
              </span>
            )}
          </div>
        </div>
        <aside className="stack">
          <BudgetPanel
            guestCount={Number(f.guestCount) || 0}
            categorySlugs={catSlugs}
            foodPreference={f.foodPreference === 'NOT_APPLICABLE' ? undefined : f.foodPreference}
            budgetPaise={f.budget ? rupeesToPaise(f.budget) : null}
          />
        </aside>
      </form>
    </div>
  );
}

