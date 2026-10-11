import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { Property, PropertyInput } from '@boogbe/shared';
import { Button, Field, Input, Select } from '@boogbe/ui';
import { api } from '../../lib/api';
import { MoneyInput, PercentInput } from './money-input';

export function PropertyForm({ initial, onSaved }: { initial?: Property; onSaved: (p: Property) => void }) {
  const f = useForm<PropertyInput>({
    resolver: zodResolver(PropertyInput) as never,
    defaultValues: initial ?? { name: '', address: '', feeType: 'none', feeBps: 0, feeFixedMonthlyKobo: 0, sortOrder: 0 },
  });
  const feeType = f.watch('feeType');
  const e = f.formState.errors;
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={f.handleSubmit(async (v) => {
        const p = await api(initial ? `/v1/properties/${initial.id}` : '/v1/properties', {
          method: initial ? 'PATCH' : 'POST',
          body: v,
          schema: Property,
        });
        onSaved(p);
      })}
    >
      <Field label="Name" error={e.name?.message}>
        <Input {...f.register('name')} />
      </Field>
      <Field label="Address" error={e.address?.message}>
        <Input {...f.register('address')} />
      </Field>
      <Field label="Area" hint="e.g. Lekki Phase 1">
        <Input {...f.register('area')} />
      </Field>
      <Field label="Management fee">
        <Select {...f.register('feeType')}>
          <option value="none">No commission</option>
          <option value="pct_gross">% of gross income</option>
          <option value="pct_net">% of net income (after expenses)</option>
        </Select>
      </Field>
      {feeType !== 'none' && (
        <Controller
          control={f.control}
          name="feeBps"
          render={({ field }) => (
            <Field label="Commission" error={e.feeBps?.message}>
              <PercentInput valueBps={field.value} onChange={field.onChange} />
            </Field>
          )}
        />
      )}
      <Controller
        control={f.control}
        name="feeFixedMonthlyKobo"
        render={({ field }) => (
          <Field label="Fixed monthly fee (optional)">
            <MoneyInput value={field.value} onChange={field.onChange} />
          </Field>
        )}
      />
      <Button type="submit" loading={f.formState.isSubmitting}>
        Save
      </Button>
    </form>
  );
}
