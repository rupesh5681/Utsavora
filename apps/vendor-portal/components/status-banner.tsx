'use client';
import Link from 'next/link';
import { Notice, formatDate } from '@utsavora/ui';
import type { VendorSelf } from '@utsavora/api-client';

/** Explains where the vendor is in verification and what to do next. */
export function StatusBanner({ v }: { v: VendorSelf }) {
  if (v.status === 'APPROVED') return null;
  if (v.status === 'DRAFT')
    return (
      <Notice tone="warn">
        <p>
          Your business isn&apos;t visible to customers yet. <Link href="/profile">Complete your profile</Link> and submit it for verification.
        </p>
      </Notice>
    );
  if (v.status === 'PENDING_REVIEW')
    return (
      <Notice tone="info">
        <p>Your profile is with the Utsavora team for verification. We usually review within one working day. You can prepare menus and packages meanwhile.</p>
      </Notice>
    );
  if (v.status === 'REJECTED')
    return (
      <Notice tone="error">
        <p>
          Verification needs changes{v.latestReview ? ` (${formatDate(v.latestReview.createdAt, 'short')})` : ''}: {v.latestReview?.notes || 'see your profile'}.{' '}
          <Link href="/profile">Update and resubmit</Link>
        </p>
      </Notice>
    );
  return (
    <Notice tone="error">
      <p>Your account is suspended{v.latestReview?.notes ? `: ${v.latestReview.notes}` : ''}. Your listings are hidden and you can&apos;t send quotes. Contact Utsavora support.</p>
    </Notice>
  );
}
