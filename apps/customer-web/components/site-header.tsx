'use client';
import Link from 'next/link';
import { NavLink, useMe, useUnreadCount } from '@utsavora/ui';

export function SiteHeader() {
  const { me, loading } = useMe();
  const unread = useUnreadCount(Boolean(me));
  return (
    <header className="site-header">
      <div className="toran" aria-hidden />
      <div className="container bar">
        <Link href="/" className="brand" aria-label="Utsavora home">
          Utsavora
        </Link>
        <nav className="site-nav" aria-label="Main">
          <NavLink href="/browse">Browse</NavLink>
          <NavLink href="/plan">Plan an event</NavLink>
          {me ? (
            <>
              <NavLink href="/requests">My requests</NavLink>
              <NavLink href="/orders">Bookings</NavLink>
              <Link href="/notifications" className="bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                Updates{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
              </Link>
              <NavLink href="/account">{me.name.split(' ')[0]}</NavLink>
            </>
          ) : (
            !loading && (
              <>
                <NavLink href="/login">Sign in</NavLink>
                <Link href="/register" className="btn btn-primary btn-sm" style={{ marginLeft: 6 }}>
                  Create account
                </Link>
              </>
            )
          )}
        </nav>
      </div>
    </header>
  );
}
