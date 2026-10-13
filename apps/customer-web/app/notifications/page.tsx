'use client';
import { NotificationsList, RequireAuth } from '@utsavora/ui';

export default function NotificationsPage() {
  return (
    <div className="container page" style={{ maxWidth: 760 }}>
      <h1>Updates</h1>
      <RequireAuth>
        <NotificationsList />
      </RequireAuth>
    </div>
  );
}
