'use client';
import { LoginForm } from '@utsavora/ui';

export default function LoginPage() {
  return (
    <div className="auth">
      <div className="auth-card">
        <LoginForm title="Utsavora admin" intro="Staff access only. Sign-ins are recorded." fallback="/" />
      </div>
    </div>
  );
}
