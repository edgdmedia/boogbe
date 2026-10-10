import { useState } from 'react';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-semibold">Reset your password</h1>
      <Card>
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
    </main>
  );
}
