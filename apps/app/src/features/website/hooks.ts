import { z } from 'zod';
import { Listing, OrgSettingsResponse } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const useListings = () => useApi('/v1/listings', z.object({ items: z.array(Listing) }));
export const useListing = (id: string | null) => useApi(id ? `/v1/listings/${id}` : null, Listing);
export const useOrgSettings = () => useApi('/v1/org/settings', OrgSettingsResponse);
