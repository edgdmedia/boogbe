import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import { TENANT_MODELS } from './tenant-models';

export const orgStore = new AsyncLocalStorage<{ orgId: string }>();

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);
const DATA_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

export const orgScope = Prisma.defineExtension({
  name: 'orgScope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const store = orgStore.getStore();
        if (!store) throw new Error(`Tenant model ${model} accessed outside OrgDb.run`);
        const { orgId } = store;
        const a = (args ?? {}) as Record<string, unknown>;
        if (WHERE_OPS.has(operation)) {
          const where = a.where as Record<string, unknown> | undefined;
          if (where && 'orgId' in where && where.orgId !== orgId) {
            throw new Error(`OrgDb: where.orgId conflicts with the active org for ${model}.${operation}`);
          }
          // extendedWhereUnique (Prisma 5) lets non-unique fields sit beside unique ones.
          a.where = { ...(where ?? {}), orgId };
        }
        if (DATA_OPS.has(operation)) {
          const conflicts = (d: unknown) =>
            d && typeof d === 'object' && 'orgId' in d && (d as { orgId: unknown }).orgId !== orgId;
          if (conflicts(a.data) || (Array.isArray(a.data) && a.data.some(conflicts))) {
            throw new Error(`OrgDb: data.orgId conflicts with the active org for ${model}.${operation}`);
          }
          if (operation === 'upsert') a.create = { ...(a.create as object), orgId };
          else if (Array.isArray(a.data)) a.data = a.data.map((d) => ({ ...d, orgId }));
          else a.data = { ...(a.data as object), orgId };
        }
        return query(a as typeof args);
      },
    },
  },
});
