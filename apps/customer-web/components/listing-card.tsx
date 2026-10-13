import Link from 'next/link';
import type { ListingSummary } from '@utsavora/api-client';
import { DemoTag, priceText } from '@utsavora/ui';

export function ListingCard({ l }: { l: ListingSummary }) {
  return (
    <article className="listing-card">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <span className="small muted">{l.category.name}</span>
        <DemoTag show={l.isDemo} />
      </div>
      <h3>
        <Link href={`/listings/${l.id}`}>{l.title}</Link>
      </h3>
      <p className="small muted" style={{ margin: 0 }}>
        by <Link href={`/vendors/${l.vendor.slug}`}>{l.vendor.businessName}</Link>
      </p>
      <p className="small clamp">{l.description}</p>
      <div className="row-between" style={{ marginTop: 'auto' }}>
        <strong className="num">{priceText(l)}</strong>
        {l.minGuests && <span className="xsmall muted">from {l.minGuests} guests</span>}
      </div>
    </article>
  );
}
