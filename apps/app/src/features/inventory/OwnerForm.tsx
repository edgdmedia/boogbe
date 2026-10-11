import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Owner, OwnerInput } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { api } from '../../lib/api';

export function OwnerForm({ initial, onSaved }: { initial?: Owner; onSaved: (o: Owner) => void }) {
  const f = useForm<OwnerInput>({ resolver: zodResolver(OwnerInput) as never, defaultValues: initial ?? { name: '' } });
  const e = f.formState.errors;
  const opt = { setValueAs: (v: string) => v || null };
  return (
    <form
      noValidate
      className="grid gap-4 md:grid-cols-2"
      onSubmit={f.handleSubmit(async (v) =>
        onSaved(await api(initial ? `/v1/owners/${initial.id}` : '/v1/owners', { method: initial ? 'PATCH' : 'POST', body: v, schema: Owner })),
      )}
    >
      <Field label="Full name" error={e.name?.message}>
        <Input {...f.register('name')} />
      </Field>
      <Field label="Phone" hint="+234…" error={e.phone?.message}>
        <Input {...f.register('phone', opt)} />
      </Field>
      <Field label="Email" hint="Needed to invite them to the owner portal" error={e.email?.message}>
        <Input type="email" {...f.register('email', opt)} />
      </Field>
      <Field label="Bank" error={e.bankName?.message}>
        <Input {...f.register('bankName', opt)} />
      </Field>
      <Field label="Account number" error={e.accountNumber?.message}>
        <Input inputMode="numeric" maxLength={10} {...f.register('accountNumber', opt)} />
      </Field>
      <Field label="Account name" error={e.accountName?.message}>
        <Input {...f.register('accountName', opt)} />
      </Field>
      <Button type="submit" loading={f.formState.isSubmitting} className="md:col-span-2">
        Save owner
      </Button>
    </form>
  );
}
