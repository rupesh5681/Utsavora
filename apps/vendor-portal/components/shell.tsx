'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavLink, RequireAuth, SignOutButton, useMe, useUnreadCount } from '@utsavora/ui';

function Side() {
  const { me } = useMe();
  const unread = useUnreadCount(Boolean(me));
  return (
    <div className="shell-side">
      <Link href="/" className="brand">
        Utsavora <small>for vendors</small>
      </Link>
      <nav aria-label="Vendor">
        <NavLink href="/" exact>
          Overview
        </NavLink>
        <NavLink href="/quotes">Requests & quotes</NavLink>
        <NavLink href="/orders">Bookings</NavLink>
        <NavLink href="/listings">Menus & packages</NavLink>
        <NavLink href="/profile">Business profile</NavLink>
        <NavLink href="/notifications">{`Updates${unread ? ` (${unread})` : ''}`}</NavLink>
      </nav>
      {me && (
        <div className="who">
          <div>{me.vendor?.businessName}</div>
          <div>{me.email}</div>
          <SignOutButton className="btn btn-ghost" />
        </div>
      )}
    </div>
  );
}

export function Shell({ title, intro, actions, children }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="shell">
        <Side />
        <main className="shell-main" id="main">
          <div className="page-head">
            <div>
              <h1>{title}</h1>
              {intro && <p className="muted">{intro}</p>}
            </div>
            {actions}
          </div>
          {children}
        </main>
      </div>
    </RequireAuth>
  );
}
