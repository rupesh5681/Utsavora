'use client';
import { useParams } from 'next/navigation';
import type { VendorProfilePublic } from '@utsavora/api-client';
import { Async, ButtonLink, DemoTag, Empty, useQuery } from '@utsavora/ui';
import { ListingCard } from '@/components/listing-card';

export default function VendorPage() {
  const { slug } = useParams<{ slug: string }>();
  const q = useQuery(`vendor:${slug}`, (api) => api.get<VendorProfilePublic>(`/vendors/${slug}`));
  return (
    <div className="container page">
      <Async state={q} lines={6}>
        {(v) => (
          <div className="stack-lg">
            <header className="stack" style={{ gap: 8 }}>
              <div className="row">
                <h1 style={{ margin: 0 }}>{v.businessName}</h1>
                <DemoTag show={v.isDemo} />
              </div>
              <div className="row small">
                {v.categories.map((c) => (
                  <span key={c.id} className="badge badge-info">
                    {c.name}
                  </span>
                ))}
                {v.fssaiVerified && <span className="badge badge-good">FSSAI licence on file</span>}
                {v.gstRegistered && <span className="badge badge-good">GST registered</span>}
              </div>
              {v.description && <p>{v.description}</p>}
              <p className="small muted">Serves {v.serviceAreas.map((a) => a.name).join(', ')}</p>
              <div>
                <ButtonLink href={`/plan?vendor=${v.id}`}>Request a quote from {v.businessName}</ButtonLink>
              </div>
            </header>
            <section>
              <h2>Menus, packages and services</h2>
              {v.listings.length ? (
                <div className="listing-grid">
                  {v.listings.map((l) => (
                    <ListingCard key={l.id} l={l} />
                  ))}
                </div>
              ) : (
                <Empty title="No listings yet">You can still request a custom quote.</Empty>
              )}
            </section>
          </div>
        )}
      </Async>
    </div>
  );
}
