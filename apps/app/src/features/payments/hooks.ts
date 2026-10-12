import { BookingLedger } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const useLedger = (bookingId: string) => useApi(`/v1/bookings/${bookingId}/ledger`, BookingLedger);
