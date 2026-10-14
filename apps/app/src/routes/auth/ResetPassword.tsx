import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { authClient } from '../../lib/auth-client';

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const token = params.get('token') ?? '';
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-semibold">Choose a new password</h1>
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.length < 10) return setErr('At least 10 characters');
            setBusy(true);
            const r = await authClient.resetPassword({ newPassword: pw, token });
            setBusy(false);
            if (r.error) return setErr('This link has expired. Request a new one.');
            nav('/auth/sign-in', { replace: true });
          }}
        >
          <Field label="New password" error={err} hint="At least 10 characters">
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy}>
            Save password
          </Button>
        </form>
      </Card>
    </main>
  );
}
