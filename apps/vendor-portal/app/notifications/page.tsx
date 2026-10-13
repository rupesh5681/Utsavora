'use client';
import { NotificationsList } from '@utsavora/ui';
import { Shell } from '@/components/shell';

export default function NotificationsPage() {
  return (
    <Shell title="Updates">
      <div style={{ maxWidth: 760 }}>
        <NotificationsList />
      </div>
    </Shell>
  );
}
