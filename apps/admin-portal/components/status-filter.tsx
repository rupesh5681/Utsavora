'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { label } from '@utsavora/ui';

/** Tab filter on ?status= that keeps other params out of the way. */
export function StatusTabs({ statuses, fallback = '' }: { statuses: string[]; fallback?: string }) {
  const path = usePathname();
  const current = useSearchParams().get('status') ?? fallback;
  return (
    <div className="tabs">
      {[...statuses, ''].map((s) => (
        <Link key={s || 'all'} href={s ? `${path}?status=${s}` : `${path}?status=`} aria-current={current === s ? 'page' : undefined}>
          {s ? label(s) : 'All'}
        </Link>
      ))}
    </div>
  );
}
