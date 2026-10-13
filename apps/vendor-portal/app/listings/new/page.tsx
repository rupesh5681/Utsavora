'use client';
import { Shell } from '@/components/shell';
import { ListingForm } from '@/components/listing-form';

export default function NewListing() {
  return (
    <Shell title="New listing" intro="Listings are saved as drafts. Submit them for review when ready.">
      <ListingForm />
    </Shell>
  );
}
