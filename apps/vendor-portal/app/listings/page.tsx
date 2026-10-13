'use client';
import Link from 'next/link';
import type { VendorListing } from '@utsavora/api-client';
import { Async, Button, ButtonLink, DemoTag, Empty, ErrorBox, label, priceText, StatusBadge, useAction, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

function Listings() {
  const q = useQuery('vendor-listings', (api) => api.get<VendorListing[]>('/vendor/listings'));
  const submit = useAction((api, id: string) => api.post<VendorListing>(`/vendor/listings/${id}/submit`));
  const del = useAction((api, id: string) => api.del(`/vendor/listings/${id}`));
  return (
    <div className="stack">
      <ErrorBox error={submit.error ?? del.error} />
      <Async state={q}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="No menus or packages yet" action={<ButtonLink href="/listings/new">Create your first listing</ButtonLink>}>
              Listings help customers find you. You can still quote on requests without them.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Listing</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/listings/${l.id}`}>{l.title}</Link> <DemoTag show={l.isDemo} />
                        <div className="xsmall muted">
                          {l.category.name}, {label(l.type).toLowerCase()}
                        </div>
                        {l.status === 'REJECTED' && l.lastModeration?.notes && <div className="xsmall" style={{ color: 'var(--danger)' }}>Reviewer: {l.lastModeration.notes}</div>}
                      </td>
                      <td className="nowrap">{priceText(l)}</td>
                      <td>
                        <StatusBadge status={l.status} />
                      </td>
                      <td className="right">
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {(l.status === 'DRAFT' || l.status === 'REJECTED') && (
                            <>
                              <Button
                                size="sm"
                                variant="peacock"
                                loading={submit.pending}
                                onClick={async () => {
                                  if (await submit.run(l.id)) await q.reload();
                                }}
                              >
                                Submit for review
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  if (window.confirm(`Delete "${l.title}"?`) && (await del.run(l.id))) await q.reload();
                                }}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
    </div>
  );
}

export default function ListingsPage() {
  return (
    <Shell title="Menus & packages" intro="Everything here is reviewed by Utsavora before customers see it." actions={<ButtonLink href="/listings/new">New listing</ButtonLink>}>
      <Listings />
    </Shell>
  );
}
