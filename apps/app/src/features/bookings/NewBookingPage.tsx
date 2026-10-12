import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '@boogbe/ui';
import { BookingForm } from './BookingForm';

export function NewBookingPage() {
  const [p] = useSearchParams();
  const nav = useNavigate();
  return (
    <Card className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">New booking</h1>
      <BookingForm
        unitId={p.get('unitId') ?? undefined}
        checkIn={p.get('checkIn') ?? undefined}
        checkOut={p.get('checkOut') ?? undefined}
        onCreated={(b) => nav(`/bookings/${b.id}`)}
      />
    </Card>
  );
}
