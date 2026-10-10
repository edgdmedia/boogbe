import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { PublicInvitation, ROLE_LABELS } from '@boogbe/shared';
import { Button, Card, EmptyState, Field, Input, Spinner } from '@boogbe/ui';
import { api } from '../../lib/api';
import { authClient } from '../../lib/auth-client';

const NewUser = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  password: z.string().min(10, 'At least 10 characters'),
});
const Existing = z.object({ password: z.string().min(1, 'Enter your password') });

export function AcceptInvite() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [inv, setInv] = useState<PublicInvitation | null>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    api(`/v1/invitations/${id}/public`, { schema: PublicInvitation })
      .then(setInv)
      .catch(() => setInv(null));
  }, [id]);
  const form = useForm<{ name?: string; password: string }>({
    resolver: zodResolver(inv?.userExists ? Existing : NewUser) as never,
  });

  if (inv === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  if (inv === null || inv.status !== 'pending' || inv.expired) {
    return (
      <main className="mx-auto max-w-sm p-4 pt-24">
        <EmptyState
          title="This invitation is no longer valid"
          body="Ask the person who invited you to send a new one."
        />
      </main>
    );
  }

  const onSubmit = form.handleSubmit(async (v) => {
    setErr(undefined);
    const r = inv.userExists
      ? await authClient.signIn.email({ email: inv.email, password: v.password })
      : await authClient.signUp.email({ email: inv.email, password: v.password, name: v.name! });
    if (r.error) return setErr(r.error.message ?? 'Could not continue');
    const a = await authClient.organization.acceptInvitation({ invitationId: inv.id });
    if (a.error) return setErr(a.error.message ?? 'Could not accept the invitation');
    await authClient.organization.setActive({ organizationId: a.data!.member.organizationId });
    nav('/', { replace: true });
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-1 text-2xl font-semibold">
        Join {inv.orgName} as {ROLE_LABELS[inv.role]}
      </h1>
      <p className="mb-6 text-sm text-ink-muted">
        {inv.userExists ? 'Sign in to accept.' : 'Create your Boogbe account to accept.'}
      </p>
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Email">
            <Input value={inv.email} disabled readOnly />
          </Field>
          {!inv.userExists && (
            <Field label="Your name" error={form.formState.errors.name?.message}>
              <Input autoComplete="name" {...form.register('name')} />
            </Field>
          )}
          <Field
            label="Password"
            error={form.formState.errors.password?.message}
            hint={inv.userExists ? undefined : 'At least 10 characters'}
          >
            <Input
              type="password"
              autoComplete={inv.userExists ? 'current-password' : 'new-password'}
              {...form.register('password')}
            />
          </Field>
          {err && (
            <p role="alert" className="text-sm text-danger">
              {err}
            </p>
          )}
          <Button type="submit" loading={form.formState.isSubmitting}>
            Accept invitation
          </Button>
        </form>
      </Card>
    </main>
  );
}
