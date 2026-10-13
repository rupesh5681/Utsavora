'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavLink, RequireAuth, SignOutButton, useMe, useUnreadCount } from '@utsavora/ui';

function Side() {
  const { me } = useMe();
  const unread = useUnreadCount(Boolean(me));
  const can = (p: string) => me?.permissions.includes(p);
  return (
    <div className="shell-side">
      <Link href="/" className="brand">
        Utsavora <small>admin</small>
      </Link>
      <nav aria-label="Admin">
        <NavLink href="/" exact>Dashboard</NavLink>
        {can('VENDORS_REVIEW') && <NavLink href="/vendors">Vendors</NavLink>}
        {can('LISTINGS_MODERATE') && <NavLink href="/listings">Listings</NavLink>}
        {can('ORDERS_MANAGE') && <NavLink href="/requests">Event requests</NavLink>}
        {can('ORDERS_MANAGE') && <NavLink href="/orders">Bookings</NavLink>}
        {can('SETTINGS_MANAGE') && <NavLink href="/settings">Commission</NavLink>}
        {can('AUDIT_VIEW') && <NavLink href="/audit">Audit log</NavLink>}
        <NavLink href="/notifications">{`Alerts${unread ? ` (${unread})` : ''}`}</NavLink>
      </nav>
      {me && (
        <div className="who">
          <div>{me.name}</div>
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
