'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { EventRequestSummary } from '@utsavora/api-client';
import { Async, ButtonLink, Empty, formatDate, Money, Pager, RequireAuth, StatusBadge, useQuery } from '@utsavora/ui';

function Requests() {
  const [page, setPage] = useState(1);
  const q = useQuery(`requests:${page}`, (api) => api.getPage<EventRequestSummary>('/requests', { page }));
  return (
    <Async state={q}>
      {(p) =>
        p.data.length === 0 ? (
          <Empty title="No requests yet" action={<ButtonLink href="/plan">Plan an event</ButtonLink>}>
            Describe your event once and matching vendors will send you quotes.
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Guests</th>
                    <th className="right">Budget</th>
                    <th>Quotes</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.data.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/requests/${r.id}`}>{r.title}</Link>
                        <div className="xsmall muted">
                          {r.reference}, {r.area}
                        </div>
                      </td>
                      <td className="nowrap">{formatDate(r.eventDate)}</td>
                      <td className="num">{r.guestCount}</td>
                      <td className="right">
                        <Money paise={r.budgetPaise} />
                      </td>
                      <td className="num">
                        {r.quotesReceived} of {r.vendorsInvited}
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager meta={p.meta} onPage={setPage} />
          </>
        )
      }
    </Async>
  );
}

export default function RequestsPage() {
  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>My requests</h1>
          <p className="muted">Each request collects quotes from matching vendors.</p>
        </div>
        <ButtonLink href="/plan">New request</ButtonLink>
      </div>
      <RequireAuth>
        <Requests />
      </RequireAuth>
    </div>
  );
}
