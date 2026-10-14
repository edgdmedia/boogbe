import { addDays, CalendarResponse, type IsoDate } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const calendarKey = (from: IsoDate, days: number) => `/v1/calendar?from=${from}&to=${addDays(from, days)}`;
export const useCalendar = (from: IsoDate, days: number) => useApi(calendarKey(from, days), CalendarResponse);
