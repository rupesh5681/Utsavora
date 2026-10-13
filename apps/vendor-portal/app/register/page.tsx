'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { RegisterVendorSchema } from '@utsavora/validation';
import { Button, ErrorBox, TextInput, useAction, useMe } from '@utsavora/ui';

export default function RegisterPage() {
  const router = useRouter();
  const { reload } = useMe();
  const [f, setF] = useState({ businessName: '', name: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reg = useAction((api, body: unknown) => api.post('/auth/register-vendor', body));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = RegisterVendorSchema.safeParse(f);
    if (!p.success) {
      const errs: Record<string, string> = {};
      for (const i of p.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    setErrors({});
    if (await reg.run(p.data)) {
      await reload();
      router.replace('/profile?welcome=1');
    }
  }

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit} noValidate>
        <div className="toran-thin" aria-hidden />
        <div>
          <h1>List your business</h1>
          <p className="muted">Free to join. We verify every vendor before customers can see them.</p>
        </div>
        <ErrorBox error={reg.error} />
        <TextInput label="Business name" value={f.businessName} onChange={set('businessName')} error={errors.businessName} />
        <TextInput label="Your name" autoComplete="name" value={f.name} onChange={set('name')} error={errors.name} />
        <TextInput label="Email" type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errors.email} />
        <TextInput label="Mobile number" type="tel" prefix="+91" inputMode="numeric" value={f.phone} onChange={set('phone')} error={errors.phone} />
        <TextInput label="Password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errors.password} hint="At least 10 characters, with a letter and a number." />
        <Button type="submit" loading={reg.pending} block>
          Create vendor account
        </Button>
        <p className="small">
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
