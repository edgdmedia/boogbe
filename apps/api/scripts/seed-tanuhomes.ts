/**
 * Usage: pnpm --filter @boogbe/api exec tsx scripts/seed-tanuhomes.ts <orgId|slug> [--dry-run]
 *
 * Idempotent: brings the operator's properties and units in line with data/tanuhomes.json (the rates shown on
 * tanuhomes.com). Creates missing properties and units, renames a unit listed under `renameFrom`, updates bedrooms,
 * guests and nightly rate, ticks "Show on website", and sets one refundable caution deposit per unit.
 * --dry-run prints what would change and rolls everything back.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uuidv7 } from 'uuidv7';
import { loadDotEnv } from '../src/env';

interface Data {
  cautionDepositKobo: number;
  properties: {
    name: string;
    address: string;
    area?: string;
    units: {
      name: string;
      renameFrom?: string;
      bedrooms: number;
      maxGuests: number;
      nightlyRateKobo: number;
    }[];
  }[];
}

const DRY_RUN = 'dry run: rolled back';

async function main() {
  const target = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!target || target.startsWith('--')) throw new Error('usage: seed-tanuhomes <orgId|slug> [--dry-run]');
  loadDotEnv(resolve(__dirname, '../../../.env'));
  const data = JSON.parse(readFileSync(resolve(__dirname, 'data/tanuhomes.json'), 'utf8')) as Data;
  for (const p of data.properties)
    for (const u of p.units)
      if (u.nightlyRateKobo <= 0) throw new Error(`${u.name}: set nightlyRateKobo first`);
  if (!(data.cautionDepositKobo > 0)) throw new Error('set cautionDepositKobo first');

  const prisma = new PrismaClient();
  const org = await prisma.organization.findFirst({ where: { OR: [{ id: target }, { slug: target }] } });
  if (!org) throw new Error(`no operator with id or slug "${target}"`);
  const orgId = org.id;
  console.log(`${dryRun ? '[dry run] ' : ''}${org.slug} (${orgId})`);
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      for (const p of data.properties) {
        let property = await tx.property.findFirst({ where: { orgId, name: p.name } });
        if (!property) {
          property = await tx.property.create({
            data: { id: uuidv7(), orgId, name: p.name, address: p.address, area: p.area },
          });
          console.log(`+ property ${p.name}`);
        }
        for (const u of p.units) {
          const want = {
            name: u.name,
            bedrooms: u.bedrooms,
            maxGuests: u.maxGuests,
            nightlyRateKobo: BigInt(u.nightlyRateKobo),
            publicListed: true,
          };
          let unit =
            (await tx.unit.findFirst({ where: { orgId, propertyId: property.id, name: u.name } })) ??
            (u.renameFrom
              ? await tx.unit.findFirst({ where: { orgId, propertyId: property.id, name: u.renameFrom } })
              : null);
          if (!unit) {
            unit = await tx.unit.create({ data: { id: uuidv7(), orgId, propertyId: property.id, ...want } });
            await tx.unitOwnership.create({
              data: { id: uuidv7(), orgId, unitId: unit.id, ownerId: null, effectiveFrom: today },
            });
            console.log(
              `+ ${p.name} / ${u.name}: ${u.bedrooms} bed, ${u.maxGuests} guests, ₦${u.nightlyRateKobo / 100}`,
            );
          } else {
            const before: Record<keyof typeof want, unknown> = unit;
            const changes = (Object.keys(want) as (keyof typeof want)[]).filter((k) => before[k] !== want[k]);
            if (changes.length) {
              await tx.unit.update({ where: { id: unit.id }, data: want });
              console.log(
                `~ ${p.name} / ${unit.name}: ${changes.map((k) => `${k} ${String(before[k])} → ${String(want[k])}`).join(', ')}`,
              );
            } else console.log(`= ${p.name} / ${u.name}`);
          }

          const cautions = await tx.unitFee.findMany({
            where: { orgId, unitId: unit.id, kind: 'caution_deposit', active: true },
          });
          const amountKobo = BigInt(data.cautionDepositKobo);
          const [keep, ...extra] = cautions;
          if (!keep) {
            await tx.unitFee.create({
              data: {
                id: uuidv7(),
                orgId,
                unitId: unit.id,
                kind: 'caution_deposit',
                label: 'Caution deposit',
                amountKobo,
                basis: 'per_stay',
                refundable: true,
                active: true,
              },
            });
            console.log(`  + caution deposit ₦${data.cautionDepositKobo / 100}`);
          } else {
            if (keep.amountKobo !== amountKobo || keep.basis !== 'per_stay' || !keep.refundable) {
              await tx.unitFee.update({
                where: { id: keep.id },
                data: { amountKobo, basis: 'per_stay', refundable: true },
              });
              console.log(
                `  ~ caution deposit ₦${Number(keep.amountKobo) / 100} → ₦${data.cautionDepositKobo / 100}`,
              );
            }
            for (const e of extra) {
              await tx.unitFee.update({ where: { id: e.id }, data: { active: false } });
              console.log(`  - duplicate caution deposit ₦${Number(e.amountKobo) / 100} switched off`);
            }
          }
        }
      }
      if (dryRun) throw new Error(DRY_RUN);
    });
  } catch (e) {
    if (!(e instanceof Error && e.message === DRY_RUN)) throw e;
    console.log('[dry run] nothing saved');
  } finally {
    await prisma.$disconnect();
  }
}
void main();
