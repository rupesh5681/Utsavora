import '@utsavora/ui/styles.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Utsavora for vendors', template: '%s | Utsavora vendors' },
  description: 'Receive event requests, send quotes and manage bookings on Utsavora.',
  icons: { icon: '/favicon.svg' },
  robots: { index: false },
};
export const viewport: Viewport = { themeColor: '#0f5c5a' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
