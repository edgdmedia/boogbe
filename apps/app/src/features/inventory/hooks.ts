import { z } from 'zod';
import { Owner, Property, Unit, UnitFee } from '@boogbe/shared';
import { useApi } from '../../lib/api';

export const useProperties = (includeArchived = false) =>
  useApi(`/v1/properties${includeArchived ? '?includeArchived=true' : ''}`, z.object({ items: z.array(Property) }));
export const useProperty = (id: string) => useApi(`/v1/properties/${id}`, Property);
export const useUnits = (propertyId?: string) =>
  useApi(`/v1/units${propertyId ? `?propertyId=${propertyId}&includeArchived=true` : ''}`, z.object({ items: z.array(Unit) }));
export const useOwners = (enabled = true) => useApi(enabled ? '/v1/owners' : null, z.object({ items: z.array(Owner) }));
export const useUnitFees = (unitId: string | null) =>
  useApi(unitId ? `/v1/units/${unitId}/fees` : null, z.object({ items: z.array(UnitFee) }));
