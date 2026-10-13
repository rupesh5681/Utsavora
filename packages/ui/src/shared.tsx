'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Notification } from '@utsavora/api-client';
import { Async, Button, Empty, ErrorBox, formatDateTime, TextInput } from './components';
import { useAction, useMe, useQuery } from './data';

function safeNext(next: string | null, fallback: string) {
  // Only allow same-site relative paths.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export function LoginForm({ title, intro, fallback = '/', footer }: { title: string; intro?: ReactNode; fallback?: string; footer?: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const { reload } = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAction((api, body: { email: string; password: string }) => api.post('/auth/login', body));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await login.run({ email, password });
    if (ok) {
      await reload();
      router.replace(safeNext(params.get('next'), fallback));
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
      </div>
      <ErrorBox error={login.error} />
      <TextInput label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" loading={login.pending} block>
        {login.pending ? 'Signing in…' : 'Sign in'}
      </Button>
      {footer}
    </form>
  );
}

export function NotificationsList() {
  const q = useQuery('notifications', (api) => api.get<{ items: Notification[]; unread: number }>('/notifications'));
  const readAll = useAction((api) => api.post('/notifications/read-all'));
  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted" style={{ margin: 0 }}>
          {q.data ? (q.data.unread ? `${q.data.unread} unread` : 'All caught up') : ' '}
        </p>
        {q.data && q.data.unread > 0 && (
          <Button
            variant="secondary"
            size="sm"
            loading={readAll.pending}
            onClick={async () => {
              await readAll.run();
              await q.reload();
            }}
          >
            Mark all as read
          </Button>
        )}
      </div>
      <Async state={q}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty title="No notifications yet">Updates on your requests, quotes and bookings will appear here.</Empty>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
              {d.items.map((n) => (
                <li key={n.id} className={`panel panel-tight ${n.readAt ? '' : 'panel-haldi'}`}>
                  <div className="row-between">
                    <strong>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</strong>
                    <span className="xsmall muted">{formatDateTime(n.createdAt)}</span>
                  </div>
                  <div className="small">{n.body}</div>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </div>
  );
}

/** Unread notification count for headers (loaded once per page view). */
export function useUnreadCount(enabled: boolean) {
  const q = useQuery(enabled ? 'unread' : null, (api) => api.get<{ unread: number }>('/notifications'));
  return q.data?.unread ?? 0;
}

export function SignOutButton({ className, to = '/login' }: { className?: string; to?: string }) {
  const { reload } = useMe();
  const router = useRouter();
  const out = useAction((api) => api.post('/auth/logout'));
  return (
    <button
      type="button"
      className={className ?? 'btn btn-ghost btn-sm'}
      onClick={async () => {
        await out.run();
        await reload();
        router.replace(to);
      }}
    >
      Sign out
    </button>
  );
}
