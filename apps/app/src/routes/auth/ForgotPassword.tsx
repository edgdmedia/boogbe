import { useState } from 'react';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';
import { AuthFrame } from './AuthFrame';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame>
      <h1 className="mb-6 text-[26px] font-bold tracking-[-0.02em]">Reset your password</h1>
      <Card className="p-6">
        {sent ? (
          <p>If that email has a Boogbe account, a reset link is on its way. It expires in 1 hour.</p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/auth/reset` });
              setSent(true);
              setBusy(false);
            }}
          >
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" loading={busy}>
              Send reset link
            </Button>
          </form>
        )}
      </Card>
    </AuthFrame>
  );
}
