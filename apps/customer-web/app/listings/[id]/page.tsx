'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ListingDetail } from '@utsavora/api-client';
import { Async, ButtonLink, DemoTag, label, priceText, useQuery } from '@utsavora/ui';

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery(`listing:${id}`, (api) => api.get<ListingDetail>(`/listings/${id}`));
  return (
    <div className="container page">
      <Async state={q} lines={6}>
        {(l) => {
          const planHref = `/plan?vendor=${l.vendor.id}&category=${l.category.id}${l.occasions[0] ? `&occasion=${l.occasions[0].id}` : ''}`;
          return (
            <div className="split">
              <article className="stack">
                <p className="small muted" style={{ margin: 0 }}>
                  <Link href={`/browse?category=${l.category.slug}`}>{l.category.name}</Link> {label(l.type).toLowerCase()}
                </p>
                <div className="row">
                  <h1 style={{ margin: 0 }}>{l.title}</h1>
                  <DemoTag show={l.isDemo} />
                </div>
                {l.isDemo && <div className="demo-banner">This is a demonstration listing used to show how Utsavora works. It is not a real vendor offer.</div>}
                <p>{l.description}</p>
                {l.inclusions.length > 0 && (
                  <section>
                    <h3>What&apos;s included</h3>
                    <ul>
                      {l.inclusions.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <section>
                  <h3>Good for</h3>
                  <div className="row">
                    {l.occasions.map((o) => (
                      <Link key={o.id} className="badge badge-info" href={`/browse?occasion=${o.slug}`}>
                        {o.name}
                      </Link>
                    ))}
                  </div>
                </section>
                <section>
                  <h3>Areas served</h3>
                  <p className="small">{l.serviceAreas.map((a) => a.name).join(', ')}</p>
                </section>
              </article>
              <aside className="panel stack">
                <div>
                  <div className="small muted">Starting price</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--t-2xl)', lineHeight: 1.1 }}>{priceText(l)}</div>
                  {(l.minGuests || l.maxGuests) && (
                    <div className="small muted">
                      {l.minGuests && `Minimum ${l.minGuests} guests`}
                      {l.minGuests && l.maxGuests && ', '}
                      {l.maxGuests && `up to ${l.maxGuests}`}
                    </div>
                  )}
                  {l.foodPreference !== 'NOT_APPLICABLE' && <div className="small">{label(l.foodPreference)}</div>}
                </div>
                <p className="small" style={{ margin: 0 }}>
                  Final price depends on your date, guests and venue. Ask {l.vendor.businessName} for an itemised quote.
                </p>
                <ButtonLink href={planHref}>Request a quote</ButtonLink>
                <Link className="small" href={`/vendors/${l.vendor.slug}`}>
                  More from {l.vendor.businessName}
                </Link>
              </aside>
            </div>
          );
        }}
      </Async>
    </div>
  );
}
