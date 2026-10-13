'use client';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { formatINR, label } from '@utsavora/types';
import type { ApiError, PageMeta } from '@utsavora/api-client';
import { useMe } from './data';

// ───────────── Formatting ─────────────

const dateFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** "2026-11-14" → "Sat, 14 Nov 2026" (date-only strings are treated as IST calendar dates). */
export function formatDate(iso: string | null | undefined, style: 'long' | 'short' = 'long'): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00+05:30`) : new Date(iso);
  return (style === 'short' ? shortDate : dateFmt).format(d);
}
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}
export function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}
export function rupeesToPaise(v: string | number): number {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export function paiseToRupees(p: number | null | undefined): string {
  return p == null ? '' : String(p / 100);
}
export { formatINR, label };

export function Money({ paise, className }: { paise: number | null | undefined; className?: string }) {
  return <span className={`num ${className ?? ''}`}>{formatINR(paise)}</span>;
}

// ───────────── Buttons ─────────────

type BtnVariant = 'primary' | 'secondary' | 'peacock' | 'danger' | 'ghost';
export function Button({
  variant = 'primary',
  size,
  block,
  loading,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; block?: boolean; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'primary', size, children, className }: { href: string; variant?: BtnVariant; size?: 'sm'; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className ?? ''}`}>
      {children}
    </Link>
  );
}

// ───────────── Form fields ─────────────

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
}

export function Field({ label: text, hint, error, className, children, htmlFor }: FieldProps & { children: ReactNode; htmlFor?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={htmlFor}>{text}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function TextInput({ label: l, hint, error, className, prefix, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement> & { prefix?: string }) {
  const id = useId();
  const input = <input id={id} className="input" aria-invalid={error ? true : undefined} {...rest} />;
  return (
    <Field label={l} hint={hint} error={error} className={className} htmlFor={id}>
      {prefix ? (
        <div className="input-prefix">
          <span aria-hidden>{prefix}</span>
          {input}
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

export function SelectInput({
  label: l,
  hint,
  error,
  className,
  options,
  placeholder,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <Field label={l} hint={hint} error={error} className={className} htmlFor={id}>
      <select id={id} className="select" aria-invalid={error ? true : undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextArea({ label: l, hint, error, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field label={l} hint={hint} error={error} className={className} htmlFor={id}>
      <textarea id={id} className="textarea" aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

/** Multi- or single-select chips backed by real checkboxes / radios. */
export function Chips({
  legend,
  options,
  value,
  onChange,
  multiple = true,
  error,
  name,
}: {
  legend: ReactNode;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  multiple?: boolean;
  error?: string;
  name?: string;
}) {
  const gid = useId();
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="chips">
        {options.map((o) => (
          <label className="chip" key={o.value}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={name ?? gid}
              checked={value.includes(o.value)}
              onChange={(e) => {
                if (!multiple) onChange([o.value]);
                else onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value));
              }}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <span className="error xsmall" role="alert" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>
          {error}
        </span>
      )}
    </fieldset>
  );
}

/** Editable list of short strings (inclusions, exclusions). */
export function ListEditor({ legend, value, onChange, placeholder }: { legend: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="stack" style={{ gap: 8 }}>
        {value.map((v, i) => (
          <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
            <input
              className="input"
              value={v}
              aria-label={`${legend} ${i + 1}`}
              placeholder={placeholder}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <Button variant="ghost" size="sm" aria-label={`Remove ${legend.toLowerCase()} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" onClick={() => onChange([...value, ''])}>
            Add item
          </Button>
        </div>
      </div>
    </fieldset>
  );
}

// ───────────── Feedback ─────────────

export function ErrorBox({ error, title }: { error: ApiError | null | undefined; title?: string }) {
  if (!error) return null;
  const details = error.code === 'ONBOARDING_INCOMPLETE' && Array.isArray(error.details) ? (error.details as { label: string }[]) : null;
  return (
    <div className="alert alert-error" role="alert">
      <p>
        {title && <strong>{title} </strong>}
        {error.message}
      </p>
      {details && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {details.map((d) => (
            <li key={d.label}>{d.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'success' | 'error' | 'info'; children: ReactNode }) {
  return <div className={`alert ${tone === 'info' ? '' : `alert-${tone}`}`}>{children}</div>;
}

export function Loading({ lines = 3, label: l = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="stack" style={{ gap: 10 }} aria-busy="true" aria-live="polite">
      <span className="sr-only">{l}…</span>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 28 : 18, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Standard wrapper for a loaded resource: loading → error (with retry) → content. */
export function Async<T>({
  state,
  children,
  lines,
}: {
  state: { data: T | undefined; error: ApiError | null; loading: boolean; reload: () => Promise<void> };
  children: (data: T) => ReactNode;
  lines?: number;
}) {
  if (state.error && !state.data) {
    return (
      <div className="stack">
        <ErrorBox error={state.error} />
        <div>
          <Button variant="secondary" size="sm" onClick={() => void state.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (state.data === undefined) return <Loading lines={lines} />;
  return <>{children(state.data)}</>;
}

// ───────────── Status ─────────────

const TONE: Record<string, string> = {
  APPROVED: 'good',
  CONFIRMED: 'good',
  COMPLETED: 'good',
  ACCEPTED: 'good',
  QUOTED: 'act',
  REVISED: 'act',
  PENDING_CONFIRMATION: 'wait',
  PAYMENT_PENDING: 'wait',
  PENDING_REVIEW: 'wait',
  REQUESTED: 'wait',
  VENDOR_REVIEWING: 'wait',
  OPEN: 'info',
  IN_PROGRESS: 'info',
  DRAFT: '',
  REJECTED: 'bad',
  SUSPENDED: 'bad',
  CANCELLED: 'bad',
  DECLINED: '',
  WITHDRAWN: '',
  EXPIRED: '',
  NOT_SELECTED: '',
};

export function StatusBadge({ status, text }: { status: string; text?: string }) {
  const tone = TONE[status];
  return <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{text ?? label(status)}</span>;
}

export function DemoTag({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="demo-tag" title="Demonstration data — not a real vendor, listing or booking">
      Demo
    </span>
  );
}

// ───────────── Overlays & navigation ─────────────

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Pager({ meta, onPage }: { meta: PageMeta | undefined; onPage: (p: number) => void }) {
  if (!meta || meta.pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
        Previous
      </Button>
      <span className="muted">
        Page {meta.page} of {meta.pageCount}
      </span>
      <Button variant="secondary" size="sm" disabled={meta.page >= meta.pageCount} onClick={() => onPage(meta.page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function NavLink({ href, children, exact }: { href: string; children: ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}

/** Redirects to the login page when there is no session. */
export function RequireAuth({ children, loginPath = '/login' }: { children: ReactNode; loginPath?: string }) {
  const { me, loading } = useMe();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !me) router.replace(`${loginPath}?next=${encodeURIComponent(path)}`);
  }, [loading, me, router, path, loginPath]);
  if (loading || !me) return <Loading lines={4} label="Checking your session" />;
  return <>{children}</>;
}

// ───────────── Domain displays ─────────────

export interface BillLike {
  subtotalPaise: number;
  discountPaise: number;
  taxBps: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  advanceBps: number;
  advancePaise: number;
}

export function Bill({ r, paidPaise }: { r: BillLike; paidPaise?: number }) {
  return (
    <table className="bill">
      <tbody>
        <tr>
          <td>Subtotal</td>
          <td>{formatINR(r.subtotalPaise)}</td>
        </tr>
        {r.discountPaise > 0 && (
          <tr>
            <td>Discount</td>
            <td>− {formatINR(r.discountPaise)}</td>
          </tr>
        )}
        <tr>
          <td>GST {r.taxBps / 100}%</td>
          <td>{formatINR(r.taxPaise)}</td>
        </tr>
        {r.deliveryPaise > 0 && (
          <tr>
            <td>Delivery & setup</td>
            <td>{formatINR(r.deliveryPaise)}</td>
          </tr>
        )}
        <tr className="total">
          <td>Total</td>
          <td>{formatINR(r.totalPaise)}</td>
        </tr>
        <tr>
          <td className="muted">Advance to book ({r.advanceBps / 100}%)</td>
          <td className="muted">{formatINR(r.advancePaise)}</td>
        </tr>
        {paidPaise !== undefined && (
          <>
            <tr>
              <td>Paid so far</td>
              <td>{formatINR(paidPaise)}</td>
            </tr>
            <tr>
              <td>
                <strong>Balance</strong>
              </td>
              <td>
                <strong>{formatINR(r.totalPaise - paidPaise)}</strong>
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

export function LineItems({ items }: { items: { description: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qty</th>
            <th className="right">Rate</th>
            <th className="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, k) => (
            <tr key={k}>
              <td>{i.description}</td>
              <td className="right num">{i.quantity}</td>
              <td className="right num">{formatINR(i.unitPricePaise)}</td>
              <td className="right num">{formatINR(i.lineTotalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ACTION_TEXT: Record<string, string> = {
  quote_accepted: 'Quote accepted, booking created',
  vendor_confirm: 'Vendor confirmed the booking',
  payment_recorded: 'Payment recorded',
  start: 'Event in progress',
  complete: 'Event completed',
  customer_cancel: 'Cancelled by customer',
  vendor_cancel: 'Cancelled by vendor',
  admin_cancel: 'Cancelled by Utsavora',
};

export function OrderTimeline({ events }: { events: { id: string; action: string; note: string; createdAt: string; toStatus: string }[] }) {
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={e.id}>
          <strong>{ACTION_TEXT[e.action] ?? label(e.action)}</strong>
          <div className="small muted">{formatDateTime(e.createdAt)}</div>
          {e.note && <div className="small">{e.note}</div>}
        </li>
      ))}
    </ol>
  );
}

export function priceText(l: { pricingMode: string; pricePaise: number | null }) {
  if (l.pricingMode === 'ON_QUOTE' || l.pricePaise == null) return 'Price on quote';
  return l.pricingMode === 'PER_GUEST' ? `${formatINR(l.pricePaise)} per guest` : formatINR(l.pricePaise);
}
