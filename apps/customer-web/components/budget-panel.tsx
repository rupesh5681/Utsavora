'use client';
import { useEffect, useState } from 'react';
import type { BudgetEstimate } from '@utsavora/api-client';
import { formatINR, useApi } from '@utsavora/ui';

const FIT_TEXT = {
  under: { tone: 'alert-error', text: 'Below the usual range' },
  tight: { tone: 'alert-warn', text: 'Within range, but tight' },
  ok: { tone: 'alert-success', text: 'Comfortable for these services' },
} as const;

/** Live, indicative budget from the server's rate cards. Never presented as a price. */
export function BudgetPanel({
  guestCount,
  categorySlugs,
  foodPreference,
  budgetPaise,
}: {
  guestCount: number;
  categorySlugs: string[];
  foodPreference?: string;
  budgetPaise?: number | null;
}) {
  const api = useApi();
  const [est, setEst] = useState<BudgetEstimate | null>(null);
  const [failed, setFailed] = useState(false);
  const ready = guestCount > 0 && categorySlugs.length > 0;
  const key = JSON.stringify({ guestCount, categorySlugs, foodPreference, budgetPaise });

  useEffect(() => {
    if (!ready) {
      setEst(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<BudgetEstimate>('/estimates/budget', {
          guestCount,
          categorySlugs,
          foodPreference: foodPreference || undefined,
          budgetPaise: budgetPaise && Number.isFinite(budgetPaise) ? budgetPaise : null,
        });
        if (live) {
          setEst(r);
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api, ready]);

  return (
    <section className="panel stack" aria-live="polite" aria-labelledby="budget-h">
      <h3 id="budget-h" style={{ margin: 0 }}>
        Indicative budget
      </h3>
      {!ready && <p className="small muted" style={{ margin: 0 }}>Add guests and at least one service to see typical costs.</p>}
      {ready && failed && <p className="small muted" style={{ margin: 0 }}>Couldn&apos;t load the estimate right now. You can still send your request.</p>}
      {ready && est && (
        <>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--t-xl)', lineHeight: 1.1 }} className="num">
              {formatINR(est.lowPaise)} – {formatINR(est.highPaise)}
            </div>
            <div className="xsmall muted">typical range for {guestCount} guests</div>
          </div>
          <table className="bill">
            <tbody>
              {est.lines.map((l) => (
                <tr key={l.categorySlug}>
                  <td>
                    {l.categoryName}
                    <div className="xsmall muted">{l.basis}</div>
                  </td>
                  <td>
                    {formatINR(l.lowPaise)} – {formatINR(l.highPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {est.fit && <div className={`alert ${FIT_TEXT[est.fit].tone}`}>{FIT_TEXT[est.fit].text}</div>}
          {est.warnings
            .filter((w) => !w.startsWith('Your budget'))
            .map((w) => (
              <p key={w} className="xsmall muted" style={{ margin: 0 }}>
                {w}
              </p>
            ))}
          <p className="xsmall muted" style={{ margin: 0 }}>
            {est.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}
