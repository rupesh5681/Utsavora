'use client';
import { useParams } from 'next/navigation';
import type { VendorListing } from '@utsavora/api-client';
import { Async, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';
import { ListingForm } from '@/components/listing-form';

export default function EditListing() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery('vendor-listings', (api) => api.get<VendorListing[]>('/vendor/listings'));
  return (
    <Shell title="Edit listing">
      <Async state={q}>{(all) => {
        const l = all.find((x) => x.id === id);
        return l ? <ListingForm listing={l} /> : <p>This listing doesn&apos;t exist or was deleted.</p>;
      }}</Async>
    </Shell>
  );
}
