import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { CreateOperatorInput, Operator } from '@boogbe/shared';
import { Button, Card, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';

export function CreateOperator() {
  const nav = useNavigate();
  const f = useForm<CreateOperatorInput>({
    resolver: zodResolver(CreateOperatorInput) as never,
    defaultValues: { timezone: 'Africa/Lagos' },
  });
  const onSubmit = f.handleSubmit(async (v) => {
    try {
      const op = await api('/v1/platform/operators', { method: 'POST', body: v, schema: Operator });
      nav(`/platform/operators/${op.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') f.setError('slug', { message: 'That slug is taken' });
      else f.setError('root', { message: (e as Error).message });
    }
  });
  return (
    <Card className="max-w-lg">
      <h1 className="mb-4 text-xl font-semibold">New operator</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Business name" error={f.formState.errors.name?.message}>
          <Input {...f.register('name')} />
        </Field>
        <Field label="Slug" hint="Used in links, e.g. tanuhomes" error={f.formState.errors.slug?.message}>
          <Input {...f.register('slug')} />
        </Field>
        <Field label="Contact email" error={f.formState.errors.contactEmail?.message}>
          <Input type="email" {...f.register('contactEmail', { setValueAs: (v) => v || undefined })} />
        </Field>
        <Field label="WhatsApp number" hint="+234…" error={f.formState.errors.whatsappPhone?.message}>
          <Input {...f.register('whatsappPhone', { setValueAs: (v) => v || undefined })} />
        </Field>
        {f.formState.errors.root && (
          <p role="alert" className="text-sm text-danger">
            {f.formState.errors.root.message}
          </p>
        )}
        <Button type="submit" loading={f.formState.isSubmitting}>
          Create operator
        </Button>
      </form>
    </Card>
  );
}
