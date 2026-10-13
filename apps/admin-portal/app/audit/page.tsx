'use client';
import { useState } from 'react';
import { Async, Empty, formatDateTime, Pager, SelectInput, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

interface Row { id: string; action: string; entityType: string; entityId: string; metadata: Record<string, unknown>; actorRole: string | null; actorName: string | null; ip: string | null; createdAt: string }
const TYPES = ['vendor', 'listing', 'event_request', 'quote', 'order', 'settings', 'user', 'outbox'].map((t) => ({ value: t, label: t.replace('_', ' ') }));

export default function AuditPage() {
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery(`audit:${type}:${page}`, (api) => api.getPage<Row>('/admin/audit-logs', { entityType: type || undefined, page, pageSize: 50 }));
  return (
    <Shell title="Audit log" intro="Every sensitive action, who took it and when.">
      <div className="stack">
        <div style={{ maxWidth: 260 }}>
          <SelectInput label="Record type" placeholder="Everything" options={TYPES} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} />
        </div>
        <Async state={q}>
          {(p) => p.data.length === 0 ? <Empty title="No entries" /> : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
                  <tbody>
                    {p.data.map((r) => (
                      <tr key={r.id}>
                        <td className="nowrap">{formatDateTime(r.createdAt)}</td>
                        <td>{r.actorName ?? 'System'}<div className="xsmall muted">{r.actorRole?.toLowerCase()}{r.ip ? `, ${r.ip}` : ''}</div></td>
                        <td>{r.action}</td>
                        <td className="xsmall">{r.entityType}<div className="muted">{r.entityId.slice(0, 8)}</div></td>
                        <td className="xsmall" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{Object.keys(r.metadata ?? {}).length ? JSON.stringify(r.metadata) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager meta={p.meta} onPage={setPage} />
            </>
          )}
        </Async>
      </div>
    </Shell>
  );
}
