import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, Field, Input, Spinner } from '@boogbe/ui';
import { ApiError } from '../../lib/api';
import { authClient } from '../../lib/auth-client';
import { safeNext } from '../../lib/safe-next';
import { useMe } from '../../lib/use-me';
import { useRefreshSession } from '../../lib/use-refresh-session';
import { AuthFrame } from './AuthFrame';

const Schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

export function SignIn() {
  const nav = useNavigate();
  const { me, isLoading } = useMe();
  const refreshSession = useRefreshSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [serverError, setServerError] = useState<string>();
  const { register, handleSubmit, formState } = useForm<z.infer<typeof Schema>>({ resolver: zodResolver(Schema) });
  const onSubmit = handleSubmit(async (v) => {
    setServerError(undefined);
    const r = await authClient.signIn.email(v);
    if (r.error) {
      return setServerError(
        r.error.status === 429 ? 'Too many attempts. Try again in 15 minutes.' : 'Invalid email or password',
      );
    }
    try {
      await refreshSession();
    } catch (e) {
      return setServerError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
    nav(next, { replace: true });
  });
  // Already signed in: no form, straight on (T-M2-13).
  if (me) return <Navigate to={next} replace />;
  if (isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <AuthFrame>
      <h1 className="mb-6 text-[26px] font-bold tracking-[-0.02em]">Sign in to Boogbe</h1>
      <Card className="p-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Email" error={formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Field label="Password" error={formState.errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          {serverError && (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
          )}
          <Button type="submit" loading={formState.isSubmitting}>
            Sign in
          </Button>
          <Link to="/auth/forgot" className="text-sm text-brand">
            Forgot password?
          </Link>
        </form>
      </Card>
    </AuthFrame>
  );
}
