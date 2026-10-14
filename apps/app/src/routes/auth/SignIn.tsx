import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { z } from 'zod';
import { MeResponse } from '@boogbe/shared';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { authClient } from '../../lib/auth-client';

const Schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

export function SignIn() {
  const nav = useNavigate();
  const { mutate } = useSWRConfig();
  const [params] = useSearchParams();
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
    // Everything cached so far was fetched signed out — including the 401 for /v1/me that made the app send us
    // here. Drop it all and load the session before navigating, or RequireAuth bounces straight back (T-M2-13).
    await mutate((key) => key !== '/v1/me', undefined, { revalidate: false });
    try {
      await mutate('/v1/me', api('/v1/me', { schema: MeResponse }), { revalidate: false });
    } catch (e) {
      return setServerError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
    nav(params.get('next') ?? '/', { replace: true });
  });
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="mb-6 text-2xl font-semibold">Sign in to Boogbe</h1>
      <Card>
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
    </main>
  );
}
