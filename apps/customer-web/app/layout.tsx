import '@utsavora/ui/styles.css';
import './customer.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: { default: 'Utsavora — celebrations, planned together', template: '%s | Utsavora' },
  description: 'Tell us about your birthday, wedding function, pooja or office party. Verified caterers, decorators and photographers in Greater Noida send you quotes to compare and book.',
  icons: { icon: '/favicon.svg' },
};
export const viewport: Viewport = { themeColor: '#0f5c5a' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <Providers>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
