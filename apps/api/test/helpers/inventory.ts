import { migratorClient } from './db';
import { newId } from '../../src/common/db/ids';

export async function seedOwner(orgId: string, o: Partial<{ name: string; email: string }> = {}) {
  const m = await migratorClient();
  const id = newId();
  await m.query(`insert into owner(id, org_id, name, email, updated_at) values ($1,$2,$3,$4,now())`, [
    id,
    orgId,
    o.name ?? 'Mrs Owner',
    o.email ?? null,
  ]);
  await m.end();
  return id;
}

export async function seedProperty(
  orgId: string,
  p: Partial<{ name: string; defaultOwnerId: string; feeType: string; feeBps: number }> = {},
) {
  const m = await migratorClient();
  const id = newId();
  await m.query(
    `insert into property(id, org_id, name, address, default_owner_id, fee_type, fee_bps, updated_at)
     values ($1,$2,$3,'Lekki Phase 1',$4,$5,$6,now())`,
    [id, orgId, p.name ?? 'The Rock', p.defaultOwnerId ?? null, p.feeType ?? 'none', p.feeBps ?? 0],
  );
  await m.end();
  return id;
}

export async function seedUnit(
  orgId: string,
  propertyId: string,
  u: Partial<{
    name: string;
    rateKobo: number;
    maxGuests: number;
    ownerId: string | null;
    from: string;
  }> = {},
) {
  const m = await migratorClient();
  const id = newId();
  await m.query(
    `insert into unit(id, org_id, property_id, name, bedrooms, max_guests, nightly_rate_kobo, updated_at)
     values ($1,$2,$3,$4,2,$5,$6,now())`,
    [id, orgId, propertyId, u.name ?? `Unit ${id.slice(-4)}`, u.maxGuests ?? 4, u.rateKobo ?? 20_000_000],
  );
  await m.query(
    `insert into unit_ownership(id, org_id, unit_id, owner_id, effective_from) values ($1,$2,$3,$4,$5)`,
    [newId(), orgId, id, u.ownerId ?? null, u.from ?? '2026-01-01'],
  );
  await m.end();
  return id;
}

export async function seedGuest(orgId: string, g: Partial<{ fullName: string; phoneE164: string }> = {}) {
  const m = await migratorClient();
  const id = newId();
  await m.query(`insert into guest(id, org_id, full_name, phone_e164, updated_at) values ($1,$2,$3,$4,now())`, [
    id,
    orgId,
    g.fullName ?? 'Ada Guest',
    g.phoneE164 ?? '+2348030000000',
  ]);
  await m.end();
  return id;
}

export async function seedBooking(
  orgId: string,
  unitId: string,
  guestId: string,
  b: { checkIn: string; checkOut: string; status?: string; totalKobo?: number; depositKobo?: number; source?: string },
) {
  const m = await migratorClient();
  const id = newId();
  await m.query(
    `insert into booking(id, org_id, ref, unit_id, guest_id, check_in, check_out, guest_count, source, status, computed_total_kobo, final_total_kobo, deposit_kobo, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,2,$11,$8,$9,$9,$10,now())`,
    [id, orgId, `T-${id.slice(-6)}`, unitId, guestId, b.checkIn, b.checkOut, b.status ?? 'confirmed', b.totalKobo ?? 10_000_000, b.depositKobo ?? 0, b.source ?? 'phone'],
  );
  await m.query(
    `insert into booking_line(id, org_id, booking_id, position, kind, label, quantity, unit_amount_kobo, amount_kobo, refundable, recognition)
     values ($1,$2,$3,0,'accommodation','Stay',1,$4,$4,false,'per_night')`,
    [newId(), orgId, id, b.totalKobo ?? 10_000_000],
  );
  await m.end();
  return id;
}
