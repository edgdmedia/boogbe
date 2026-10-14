import { Prisma } from '@prisma/client';

/** Every Prisma model that has an `orgId` field, except JobRun (worker bookkeeping, nullable org). */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.name !== 'JobRun' && m.fields.some((f) => f.name === 'orgId'))
    .map((m) => m.name),
);
