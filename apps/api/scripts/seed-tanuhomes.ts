/** Usage: pnpm --filter @boogbe/api exec tsx scripts/seed-tanuhomes.ts <orgId> */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { loadDotEnv } from '../src/env';

interface Data {
  properties: {
    name: string;
    address: string;
    area?: string;
    units: { name: string; bedrooms: number; maxGuests: number; nightlyRateKobo: number }[];
  }[];
}

async function main() {
  const orgId = process.argv[2];
  if (!orgId) throw new Error('usage: seed-tanuhomes <orgId>');
  loadDotEnv(resolve(__dirname, '../../../.env'));
  const data = JSON.parse(readFileSync(resolve(__dirname, 'data/tanuhomes.json'), 'utf8')) as Data;
  for (const p of data.properties) for (const u of p.units) if (u.nightlyRateKobo <= 0) throw new Error(`${u.name}: set nightlyRateKobo first`);
  const prisma = new PrismaClient();
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
    for (const p of data.properties) {
      const existing = await tx.property.findFirst({ where: { orgId, name: p.name } });
      const propertyId =
        existing?.id ?? (await tx.property.create({ data: { id: uuidv7(), orgId, name: p.name, address: p.address, area: p.area } })).id;
      for (const u of p.units) {
        if (await tx.unit.findFirst({ where: { orgId, propertyId, name: u.name } })) continue;
        const id = uuidv7();
        await tx.unit.create({
          data: { id, orgId, propertyId, name: u.name, bedrooms: u.bedrooms, maxGuests: u.maxGuests, nightlyRateKobo: BigInt(u.nightlyRateKobo) },
        });
        await tx.unitOwnership.create({ data: { id: uuidv7(), orgId, unitId: id, ownerId: null, effectiveFrom: today } });
        console.log(`+ ${p.name} / ${u.name}`);
      }
    }
  });
  await prisma.$disconnect();
}
void main();
