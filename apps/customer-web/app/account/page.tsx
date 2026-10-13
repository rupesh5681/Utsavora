'use client';
import { RequireAuth, SignOutButton, useMe } from '@utsavora/ui';

function Account() {
  const { me } = useMe();
  if (!me) return null;
  return (
    <div className="stack">
      <dl className="kv panel">
        <dt>Name</dt>
        <dd>{me.name}</dd>
        <dt>Email</dt>
        <dd>{me.email}</dd>
        <dt>Mobile</dt>
        <dd>+91 {me.phone}</dd>
      </dl>
      <div>
        <SignOutButton className="btn btn-secondary" to="/" />
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <div className="container page" style={{ maxWidth: 640 }}>
      <h1>Your account</h1>
      <RequireAuth>
        <Account />
      </RequireAuth>
    </div>
  );
}
