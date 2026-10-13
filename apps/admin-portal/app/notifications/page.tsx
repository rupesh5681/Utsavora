'use client';
import { Async, Button, Empty, formatDateTime, NotificationsList, useAction, useMe, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

interface Failure { id: string; type: string; attempts: number; lastError: string | null; createdAt: string }

function Failures() {
  const q = useQuery('failures', (api) => api.get<Failure[]>('/admin/notification-failures'));
  const retry = useAction((api, ids: string[]) => api.post('/admin/notification-failures/retry', { ids }));
  return (
    <section className="stack">
      <h2 className="section-title">Delivery failures</h2>
      <Async state={q}>
        {(rows) => rows.length === 0 ? <Empty title="No failed notifications" /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Event</th><th>Attempts</th><th>Last error</th><th>Created</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.id}><td>{r.type}</td><td className="num">{r.attempts}</td><td className="xsmall">{r.lastError}</td><td className="nowrap">{formatDateTime(r.createdAt)}</td></tr>)}</tbody>
              </table>
            </div>
            <div><Button variant="secondary" size="sm" loading={retry.pending} onClick={async () => { await retry.run(rows.map((r) => r.id)); await q.reload(); }}>Retry all</Button></div>
          </>
        )}
      </Async>
    </section>
  );
}

export default function AlertsPage() {
  const { me } = useMe();
  return (
    <Shell title="Alerts">
      <div className="stack-lg" style={{ maxWidth: 900 }}>
        <NotificationsList />
        {me?.permissions.includes('AUDIT_VIEW') && <Failures />}
      </div>
    </Shell>
  );
}
