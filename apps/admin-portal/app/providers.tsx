'use client';
import { Suspense, type ReactNode } from 'react';
import { AppProviders, Loading } from '@utsavora/ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    // Suspense sits outside the providers so the session check cannot resolve before the page hydrates.
    <Suspense fallback={<Loading />}>
      <AppProviders app="admin">{children}</AppProviders>
    </Suspense>
  );
}
