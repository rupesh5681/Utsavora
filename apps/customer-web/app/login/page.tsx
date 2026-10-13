'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { LoginForm } from '@utsavora/ui';

export default function LoginPage() {
  const next = useSearchParams().get('next');
  return (
    <div className="container page" style={{ maxWidth: 460 }}>
      <LoginForm
        title="Welcome back"
        intro="Sign in to see your requests, quotes and bookings."
        fallback="/requests"
        footer={
          <p className="small">
            New to Utsavora? <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link>
          </p>
        }
      />
    </div>
  );
}
