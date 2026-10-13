'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { RegisterCustomerSchema } from '@utsavora/validation';
import { Button, ErrorBox, TextInput, useAction, useMe } from '@utsavora/ui';

export default function RegisterPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const { reload } = useMe();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reg = useAction((api, body: unknown) => api.post('/auth/register', body));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = RegisterCustomerSchema.safeParse(f);
    if (!p.success) {
      const errs: Record<string, string> = {};
      for (const i of p.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setErrors({});
    if (await reg.run(p.data)) {
      await reload();
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/plan');
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="container page" style={{ maxWidth: 460 }}>
      <form className="stack" onSubmit={submit} noValidate>
        <div>
          <h1>Create your account</h1>
          <p className="muted">So vendors can send you quotes and you can track your bookings.</p>
        </div>
        <ErrorBox error={reg.error} />
        <TextInput label="Full name" autoComplete="name" value={f.name} onChange={set('name')} error={errors.name} />
        <TextInput label="Email" type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errors.email} />
        <TextInput label="Mobile number" type="tel" autoComplete="tel-national" prefix="+91" inputMode="numeric" value={f.phone} onChange={set('phone')} error={errors.phone} hint="Shared with a vendor only after you book them." />
        <TextInput label="Password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errors.password} hint="At least 10 characters, with a letter and a number." />
        <Button type="submit" loading={reg.pending} block>
          Create account
        </Button>
        <p className="small">
          Already registered? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
