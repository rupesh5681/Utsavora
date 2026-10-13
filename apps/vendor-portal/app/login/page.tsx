'use client';
import Link from 'next/link';
import { LoginForm } from '@utsavora/ui';

export default function LoginPage() {
  return (
    <div className="auth">
      <div className="auth-card stack">
        <div className="toran-thin" aria-hidden />
        <LoginForm
          title="Vendor sign in"
          intro="See new event requests, send quotes and manage your bookings."
          fallback="/"
          footer={
            <p className="small">
              New to Utsavora? <Link href="/register">Register your business</Link>
            </p>
          }
        />
      </div>
    </div>
  );
}
