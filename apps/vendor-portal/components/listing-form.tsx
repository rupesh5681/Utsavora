'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ListingSchema } from '@utsavora/validation';
import type { VendorListing, VendorSelf } from '@utsavora/api-client';
import { Button, Chips, ErrorBox, ListEditor, Loading, Notice, paiseToRupees, rupeesToPaise, SelectInput, TextArea, TextInput, useAction, useQuery } from '@utsavora/ui';
import { useRefData } from './ref-data';

const TYPES = [
  { value: 'MENU', label: 'Menu (food)' },
  { value: 'PACKAGE', label: 'Package (bundle of items)' },
  { value: 'SERVICE', label: 'Service' },
];
const PRICING = [
  { value: 'PER_GUEST', label: 'Per guest' },
  { value: 'FIXED', label: 'Fixed price' },
  { value: 'ON_QUOTE', label: 'Price on quote' },
];
const FOOD = [
  { value: 'NOT_APPLICABLE', label: 'Not food' },
  { value: 'VEG', label: 'Veg' },
  { value: 'JAIN', label: 'Jain' },
  { value: 'NON_VEG', label: 'Non-veg' },
  { value: 'MIXED', label: 'Veg + Non-veg' },
];

export function ListingForm({ listing }: { listing?: VendorListing }) {
  const router = useRouter();
  const ref = useRefData();
  const me = useQuery('vendor-me', (api) => api.get<VendorSelf>('/vendor/me'));
  const [f, setF] = useState({
    categoryId: listing?.categoryId ?? '',
    title: listing?.title ?? '',
    description: listing?.description ?? '',
    type: listing?.type ?? 'MENU',
    pricingMode: listing?.pricingMode ?? 'PER_GUEST',
    price: paiseToRupees(listing?.pricePaise),
    minGuests: listing?.minGuests ? String(listing.minGuests) : '',
    maxGuests: listing?.maxGuests ? String(listing.maxGuests) : '',
    foodPreference: listing?.foodPreference ?? 'NOT_APPLICABLE',
    inclusions: listing?.inclusions ?? [],
    occasionIds: listing?.occasionIds ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction((api, body: unknown) =>
    listing ? api.put<VendorListing>(`/vendor/listings/${listing.id}`, body) : api.post<VendorListing>('/vendor/listings', body),
  );
  useEffect(() => {
    if (save.error) setErrors(save.error.fieldErrors);
  }, [save.error]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  if (!ref.data || !me.data) return <Loading lines={8} />;
  const offered = ref.data.categories.filter((c) => me.data!.categoryIds.includes(c.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      categoryId: f.categoryId,
      title: f.title,
      description: f.description,
      type: f.type,
      pricingMode: f.pricingMode,
      pricePaise: f.pricingMode === 'ON_QUOTE' || !f.price ? null : rupeesToPaise(f.price),
      minGuests: f.minGuests ? Number(f.minGuests) : null,
      maxGuests: f.maxGuests ? Number(f.maxGuests) : null,
      foodPreference: f.foodPreference,
      inclusions: f.inclusions.map((s) => s.trim()).filter(Boolean),
      occasionIds: f.occasionIds,
    };
    const p = ListingSchema.safeParse(body);
    if (!p.success) {
      const errs: Record<string, string> = {};
      for (const i of p.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setErrors({});
    const r = await save.run(p.data);
    if (r) router.push(`/listings?saved=${r.id}`);
  }

  return (
    <form className="stack-lg" onSubmit={submit} noValidate style={{ maxWidth: 820 }}>
      {listing?.status === 'APPROVED' && <Notice tone="warn">Saving changes takes this listing offline until Utsavora re-approves it.</Notice>}
      {offered.length === 0 && <Notice tone="warn">Add at least one service category to your business profile before creating listings.</Notice>}
      <div className="form-grid">
        <SelectInput
          label="Category"
          placeholder="Choose a category"
          options={offered.map((c) => ({ value: c.id, label: c.name }))}
          value={f.categoryId}
          onChange={set('categoryId')}
          error={errors.categoryId}
        />
        <SelectInput label="Type" options={TYPES} value={f.type} onChange={set('type')} />
        <TextInput className="span-2" label="Title" placeholder="e.g. Shubh Utsav veg buffet" value={f.title} onChange={set('title')} error={errors.title} />
        <TextArea
          className="span-2"
          label="Description"
          hint="Dishes, items, duration or what the customer gets."
          maxLength={5000}
          value={f.description}
          onChange={set('description')}
          error={errors.description}
        />
        <SelectInput label="Pricing" options={PRICING} value={f.pricingMode} onChange={set('pricingMode')} />
        {f.pricingMode !== 'ON_QUOTE' && (
          <TextInput
            label={f.pricingMode === 'PER_GUEST' ? 'Price per guest' : 'Price'}
            prefix="₹"
            inputMode="decimal"
            hint="Before GST"
            value={f.price}
            onChange={(e) => setF((x) => ({ ...x, price: e.target.value.replace(/[^\d.]/g, '') }))}
            error={errors.pricePaise}
          />
        )}
        <TextInput label="Minimum guests" type="number" min={1} value={f.minGuests} onChange={set('minGuests')} error={errors.minGuests} />
        <TextInput label="Maximum guests" type="number" min={1} value={f.maxGuests} onChange={set('maxGuests')} error={errors.maxGuests} />
        <SelectInput label="Food" options={FOOD} value={f.foodPreference} onChange={set('foodPreference')} />
      </div>
      <Chips
        legend="Suitable occasions"
        options={ref.data.occasions.map((o) => ({ value: o.id, label: o.name }))}
        value={f.occasionIds}
        onChange={(v) => setF((x) => ({ ...x, occasionIds: v }))}
      />
      <ListEditor legend="What's included" value={f.inclusions} onChange={(v) => setF((x) => ({ ...x, inclusions: v }))} placeholder="e.g. Serving staff" />
      <ErrorBox error={save.error && !Object.keys(save.error.fieldErrors).length ? save.error : null} />
      <div className="row">
        <Button type="submit" loading={save.pending}>
          {listing ? 'Save changes' : 'Save as draft'}
        </Button>
        <Button variant="secondary" onClick={() => router.push('/listings')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
