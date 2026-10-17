import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, PageHeader } from '@boogbe/ui';
import { BookingForm } from './BookingForm';

export function NewBookingPage() {
  const [p] = useSearchParams();
  const nav = useNavigate();
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <PageHeader title="New booking" />
      <Card>
        <BookingForm
          unitId={p.get('unitId') ?? undefined}
          checkIn={p.get('checkIn') ?? undefined}
          checkOut={p.get('checkOut') ?? undefined}
          onCreated={(b) => nav(`/bookings/${b.id}`)}
        />
      </Card>
    </div>
  );
}
