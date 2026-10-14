import { z } from 'zod';
import { IcalExport, IcalFeed, SyncConflict } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const useUnitIcal = (unitId: string) =>
  useApi(`/v1/units/${unitId}/ical`, z.object({ feeds: z.array(IcalFeed), exports: z.array(IcalExport) }));
export const useConflicts = (status: 'open' | 'resolved' | null) =>
  useApi(status ? `/v1/ical/conflicts?status=${status}` : null, z.object({ items: z.array(SyncConflict) }));
