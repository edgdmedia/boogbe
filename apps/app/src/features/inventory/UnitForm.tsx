import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Unit, UnitInput } from '@boogbe/shared';
import { Button, Field, Input, Select, Textarea } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { MoneyInput, PercentInput } from './money-input';

export function UnitForm({
  propertyId,
  initial,
  onSaved,
}: {
  propertyId: string;
  initial?: Unit;
  onSaved: (u: Unit) => void;
}) {
  const f = useForm<UnitInput>({
    resolver: zodResolver(UnitInput) as never,
    defaultValues:
      initial ?? {
        propertyId,
        name: '',
        bedrooms: 1,
        maxGuests: 2,
        nightlyRateKobo: 0,
        defaultAssigneeMemberId: null,
        feeOverride: false,
        feeType: 'none',
        feeBps: 0,
        feeFixedMonthlyKobo: 0,
        sortOrder: 0,
        publicListed: false,
      },
  });
  const publicHint = useId();
  const override = f.watch('feeOverride');
  const e = f.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4 md:grid-cols-2"
      onSubmit={f.handleSubmit(async (v) => {
        try {
          onSaved(
            await api(initial ? `/v1/units/${initial.id}` : '/v1/units', { method: initial ? 'PATCH' : 'POST', body: v, schema: Unit }),
          );
        } catch (err) {
          if (err instanceof ApiError && err.code === 'CONFLICT') f.setError('name', { message: 'A unit with this name already exists here' });
          else throw err;
        }
      })}
    >
      <Field label="Unit name" error={e.name?.message}>
        <Input {...f.register('name')} />
      </Field>
      <Controller
        control={f.control}
        name="nightlyRateKobo"
        render={({ field }) => (
          <Field label="Nightly rate" error={e.nightlyRateKobo?.message}>
            <MoneyInput value={field.value} onChange={field.onChange} />
          </Field>
        )}
      />
      <Field label="Bedrooms" error={e.bedrooms?.message}>
        <Input type="number" min={0} {...f.register('bedrooms', { valueAsNumber: true })} />
      </Field>
      <Field label="Max guests" error={e.maxGuests?.message}>
        <Input type="number" min={1} {...f.register('maxGuests', { valueAsNumber: true })} />
      </Field>
      <Field label="Check-in instructions" hint="Sent to guests the day before arrival. Owners never see this.">
        <Textarea {...f.register('checkInInstructions')} />
      </Field>
      <div className="flex flex-col gap-1 md:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" aria-describedby={publicHint} {...f.register('publicListed')} />
          Show on website
        </label>
        <p id={publicHint} className="text-xs text-ink-muted">
          Guests can see availability and request this apartment on your website.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" {...f.register('feeOverride')} />
        Use a different management fee for this unit
      </label>
      {override && (
        <>
          <Field label="Management fee">
            <Select {...f.register('feeType')}>
              <option value="none">No commission</option>
              <option value="pct_gross">% of gross</option>
              <option value="pct_net">% of net</option>
            </Select>
          </Field>
          <Controller
            control={f.control}
            name="feeBps"
            render={({ field }) => (
              <Field label="Commission">
                <PercentInput valueBps={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          <Controller
            control={f.control}
            name="feeFixedMonthlyKobo"
            render={({ field }) => (
              <Field label="Fixed monthly fee">
                <MoneyInput value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
        </>
      )}
      <Button type="submit" loading={f.formState.isSubmitting} className="md:col-span-2">
        Save unit
      </Button>
    </form>
  );
}
