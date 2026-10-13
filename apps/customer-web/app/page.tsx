'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ListingSummary } from '@utsavora/api-client';
import { Async, Button, ButtonLink, Chips, Loading, TextInput, todayISO, useQuery } from '@utsavora/ui';
import { useRefData } from '@/components/ref-data';
import { ListingCard } from '@/components/listing-card';

function Starter() {
  const ref = useRefData();
  const router = useRouter();
  const [occasion, setOccasion] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [guests, setGuests] = useState('');

  function start(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (occasion[0]) p.set('occasion', occasion[0]);
    if (date) p.set('date', date);
    if (guests) p.set('guests', guests);
    router.push(`/plan?${p.toString()}`);
  }

  return (
    <form className="starter stack" onSubmit={start}>
      <h2>What are you celebrating?</h2>
      {ref.data ? (
        <Chips
          legend={<span className="sr-only">Occasion</span>}
          multiple={false}
          options={ref.data.occasions.map((o) => ({ value: o.id, label: o.name }))}
          value={occasion}
          onChange={setOccasion}
        />
      ) : (
        <Loading lines={1} />
      )}
      <div className="grid-2">
        <TextInput label="Date" type="date" min={todayISO(1)} value={date} onChange={(e) => setDate(e.target.value)} />
        <TextInput label="Guests" type="number" inputMode="numeric" min={1} placeholder="e.g. 80" value={guests} onChange={(e) => setGuests(e.target.value)} />
      </div>
      <Button type="submit" block>
        Continue planning
      </Button>
      <p className="xsmall muted" style={{ margin: 0 }}>
        Free to ask. You only pay when you accept a quote.
      </p>
    </form>
  );
}

export default function Home() {
  const ref = useRefData();
  const featured = useQuery('featured', (api) => api.getPage<ListingSummary>('/listings', { pageSize: 6 }));

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <h1>Tell us about your celebration. We&apos;ll bring the quotes.</h1>
            <p className="lede">
              Share the date, guests and budget once. Verified caterers, decorators and photographers in Greater Noida reply with itemised quotes you can
              compare side by side.
            </p>
          </div>
          <Starter />
        </div>
      </section>

      <section className="band">
        <div className="container">
          <h2>Browse by occasion</h2>
          <Async state={ref} lines={5}>
            {(d) => (
              <nav className="occasion-list" aria-label="Occasions">
                {d.occasions.map((o) => (
                  <Link key={o.id} href={`/browse?occasion=${o.slug}`}>
                    <span className="name">{o.name}</span>
                    <span className="muted">{o.description}</span>
                    <span className="go">See vendors</span>
                  </Link>
                ))}
              </nav>
            )}
          </Async>
        </div>
      </section>

      <section className="band">
        <div className="container">
          <h2>How booking works</h2>
          <ol className="steps">
            <li>
              <h3>Share your event</h3>
              <p className="muted">Occasion, date, area, guests, food preference and the services you need. We show an indicative budget as you go.</p>
            </li>
            <li>
              <h3>Compare quotes</h3>
              <p className="muted">Matching vendors send itemised quotes with inclusions, GST and the advance they need. Vendors can revise; you always see the latest.</p>
            </li>
            <li>
              <h3>Book with an advance</h3>
              <p className="muted">Accept one quote. The vendor confirms, you pay the advance, and you can track the booking until the day.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="band">
        <div className="container">
          <div className="row-between" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>On Utsavora now</h2>
            <ButtonLink href="/browse" variant="secondary" size="sm">
              Browse everything
            </ButtonLink>
          </div>
          <Async state={featured}>
            {(p) =>
              p.data.length ? (
                <div className="listing-grid">
                  {p.data.map((l) => (
                    <ListingCard key={l.id} l={l} />
                  ))}
                </div>
              ) : (
                <p className="muted">Vendors are being verified. Post a request and we&apos;ll match you as they join.</p>
              )
            }
          </Async>
        </div>
      </section>
    </>
  );
}
