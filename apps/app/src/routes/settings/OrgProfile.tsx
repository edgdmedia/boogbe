import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { OrgSettingsResponse, UpdateOrgSettingsInput } from '@boogbe/shared';
import { Button, Card, Field, Input, Spinner } from '@boogbe/ui';
import { api, useApi } from '../../lib/api';

export function OrgProfile() {
  const { data, mutate } = useApi('/v1/org/settings', OrgSettingsResponse);
  const f = useForm<UpdateOrgSettingsInput>({ resolver: zodResolver(UpdateOrgSettingsInput) as never });
  useEffect(() => {
    if (data) {
      f.reset({
        name: data.org.name,
        contactEmail: data.org.contactEmail,
        whatsappPhone: data.org.whatsappPhone,
        address: data.org.address,
        ...data.settings,
      });
    }
  }, [data, f]);
  if (!data) return <Spinner />;
  const e = f.formState.errors;
  return (
    <Card className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Business settings</h1>
      <form
        className="grid gap-4 md:grid-cols-2"
        noValidate
        onSubmit={f.handleSubmit(async (v) => {
          await api('/v1/org/settings', { method: 'PATCH', body: v });
          await mutate();
        })}
      >
        <Field label="Business name" error={e.name?.message}>
          <Input {...f.register('name')} />
        </Field>
        <Field label="Contact email" error={e.contactEmail?.message}>
          <Input type="email" {...f.register('contactEmail')} />
        </Field>
        <Field label="WhatsApp number" hint="+234…" error={e.whatsappPhone?.message}>
          <Input {...f.register('whatsappPhone')} />
        </Field>
        <Field label="Address" error={e.address?.message}>
          <Input {...f.register('address')} />
        </Field>
        <Field label="Check-in time" error={e.checkInTime?.message}>
          <Input type="time" {...f.register('checkInTime')} />
        </Field>
        <Field label="Check-out time" error={e.checkOutTime?.message}>
          <Input type="time" {...f.register('checkOutTime')} />
        </Field>
        <Field label="Hold tentative bookings for (hours)" error={e.holdHours?.message}>
          <Input type="number" {...f.register('holdHours', { valueAsNumber: true })} />
        </Field>
        <Field label="Booking reference prefix" error={e.bookingPrefix?.message}>
          <Input {...f.register('bookingPrefix')} />
        </Field>
        <Field label="Receipt prefix" error={e.receiptPrefix?.message}>
          <Input {...f.register('receiptPrefix')} />
        </Field>
        <Field label="Statement prefix" error={e.statementPrefix?.message}>
          <Input {...f.register('statementPrefix')} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...f.register('autoConfirmOnPayment')} />
          Confirm bookings automatically on first payment
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...f.register('ownerSeesGuestNames')} />
          Property owners can see guest names
        </label>
        <Button type="submit" loading={f.formState.isSubmitting} className="md:col-span-2">
          Save
        </Button>
      </form>
    </Card>
  );
}
