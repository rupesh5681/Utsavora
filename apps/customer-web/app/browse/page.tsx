'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ListingSummary } from '@utsavora/api-client';
import { Async, ButtonLink, Empty, Pager, rupeesToPaise, SelectInput, TextInput, useQuery } from '@utsavora/ui';
import { useRefData } from '@/components/ref-data';
import { ListingCard } from '@/components/listing-card';

const FOOD = [
  { value: 'VEG', label: 'Veg' },
  { value: 'JAIN', label: 'Jain' },
  { value: 'NON_VEG', label: 'Non-veg' },
  { value: 'MIXED', label: 'Veg + Non-veg' },
];
const SORT = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
];

export default function BrowsePage() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const ref = useRefData();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const filters = {
    q: params.get('q') ?? '',
    occasion: params.get('occasion') ?? '',
    category: params.get('category') ?? '',
    area: params.get('area') ?? '',
    food: params.get('food') ?? '',
    max: params.get('max') ?? '',
    sort: params.get('sort') ?? 'relevance',
    page: Number(params.get('page') ?? 1),
  };
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    router.replace(`${path}?${p.toString()}`, { scroll: k === 'page' });
  };

  const results = useQuery(`listings?${params.toString()}`, (api) =>
    api.getPage<ListingSummary>('/listings', {
      q: filters.q,
      occasion: filters.occasion,
      category: filters.category,
      area: filters.area,
      food: filters.food,
      maxPricePaise: filters.max ? rupeesToPaise(filters.max) : undefined,
      sort: filters.sort,
      page: filters.page,
      pageSize: 12,
    }),
  );
  const occasionName = ref.data?.occasions.find((o) => o.slug === filters.occasion)?.name;
  const hasFilters = Boolean(filters.q || filters.occasion || filters.category || filters.area || filters.food || filters.max);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>{occasionName ? `${occasionName} in Greater Noida` : 'Browse vendors and packages'}</h1>
          <p className="muted">Menus, décor, photography and more from verified local vendors.</p>
        </div>
        <ButtonLink href={`/plan${filters.occasion && ref.data ? `?occasion=${ref.data.occasions.find((o) => o.slug === filters.occasion)?.id ?? ''}` : ''}`}>
          Get quotes for my event
        </ButtonLink>
      </div>
      <div className="browse">
        <aside className="filters" aria-label="Filters">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              set('q', q.trim());
            }}
          >
            <TextInput label="Search" type="search" placeholder="Paneer, balloon arch, candid…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <SelectInput
            label="Occasion"
            placeholder="Any occasion"
            value={filters.occasion}
            onChange={(e) => set('occasion', e.target.value)}
            options={(ref.data?.occasions ?? []).map((o) => ({ value: o.slug, label: o.name }))}
          />
          <SelectInput
            label="Service"
            placeholder="All services"
            value={filters.category}
            onChange={(e) => set('category', e.target.value)}
            options={(ref.data?.categories ?? []).map((c) => ({ value: c.slug, label: c.name }))}
          />
          <SelectInput
            label="Area"
            placeholder="All of Greater Noida"
            value={filters.area}
            onChange={(e) => set('area', e.target.value)}
            options={(ref.data?.areas ?? []).map((a) => ({ value: a.slug, label: a.name }))}
          />
          <SelectInput label="Food" placeholder="Any" value={filters.food} onChange={(e) => set('food', e.target.value)} options={FOOD} />
          <TextInput
            label="Max price"
            prefix="₹"
            inputMode="numeric"
            hint="Per guest for menus, total for packages"
            defaultValue={filters.max}
            onBlur={(e) => set('max', e.target.value.replace(/[^\d]/g, ''))}
          />
          <SelectInput label="Sort by" value={filters.sort} onChange={(e) => set('sort', e.target.value)} options={SORT} />
          {hasFilters && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.replace(path)}>
              Clear filters
            </button>
          )}
        </aside>
        <section aria-live="polite">
          <Async state={results} lines={6}>
            {(p) =>
              p.data.length === 0 ? (
                <Empty title="Nothing matches those filters" action={<ButtonLink href="/plan">Send a request instead</ButtonLink>}>
                  Try a wider area or price, or tell us what you need and matching vendors will quote.
                </Empty>
              ) : (
                <>
                  <p className="small muted">
                    {p.meta.total} {p.meta.total === 1 ? 'result' : 'results'}
                  </p>
                  <div className="listing-grid">
                    {p.data.map((l) => (
                      <ListingCard key={l.id} l={l} />
                    ))}
                  </div>
                  <Pager meta={p.meta} onPage={(n) => set('page', String(n))} />
                </>
              )
            }
          </Async>
        </section>
      </div>
    </div>
  );
}
