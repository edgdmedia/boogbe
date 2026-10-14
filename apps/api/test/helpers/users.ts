import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import type { OrgRole } from '@boogbe/shared';
import { migratorClient } from './db';
import type { TestApp } from './app';
import { AUTH } from '../../src/common/auth/auth.tokens';
import type { Auth } from '../../src/common/auth/auth';

export async function seedOrg(name = `Org ${randomUUID().slice(0, 6)}`) {
  const c = await migratorClient();
  const id = randomUUID();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40);
  try {
    await c.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1,$2,$3, now())`, [id, name, slug]);
  } finally {
    await c.end();
  }
  return { id, slug };
}

/** Inserts an org + inviter + pending invitation for `email`; returns the invitation id. */
export async function seedInvitation(email: string): Promise<string> {
  const c = await migratorClient();
  try {
    const org = await seedOrg();
    const inviter = randomUUID();
    const id = randomUUID();
    await c.query(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'seed',$2,true,now(),now())`,
      [inviter, `seed-${inviter}@test.boogbe`],
    );
    await c.query(
      `INSERT INTO invitation(id,"organizationId",email,role,status,"expiresAt","inviterId","createdAt")
       VALUES ($1,$2,$3,'frontdesk','pending', now() + interval '1 day',$4, now())`,
      [id, org.id, email, inviter],
    );
    return id;
  } finally {
    await c.end();
  }
}

/** Creates a user through Better Auth. A pending invitation is created first and its id is
 *  passed to sign-up, so both the invite-only gate and the invitation-binding check (T-M0-15)
 *  are satisfied on the server-API path exactly like the real accept-invite flow. */
export async function seedUser(
  t: TestApp,
  p: { email?: string; password?: string; name?: string; platformAdmin?: boolean } = {},
) {
  const email = (p.email ?? `u-${randomUUID().slice(0, 8)}@test.boogbe`).toLowerCase();
  const password = p.password ?? 'correct-horse-battery';
  const invitationId = await seedInvitation(email);
  const auth = t.app.get<Auth>(AUTH);
  const r = await auth.api.signUpEmail({ body: { email, password, name: p.name ?? 'Test User', invitationId } as never });
  if (p.platformAdmin) {
    const c = await migratorClient();
    try {
      await c.query(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [r.user.id]);
    } finally {
      await c.end();
    }
  }
  return { id: r.user.id, email, password };
}

export async function addMember(orgId: string, userId: string, role: OrgRole): Promise<string> {
  const c = await migratorClient();
  const id = randomUUID();
  try {
    await c.query(`INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())`, [
      id,
      orgId,
      userId,
      role,
    ]);
  } finally {
    await c.end();
  }
  return id;
}

export async function signIn(t: TestApp, email: string, password: string) {
  const agent = t.agent();
  const res = await agent.post('/v1/auth/sign-in/email').send({ email, password });
  if (res.status !== 200) throw new Error(`sign-in failed ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function signInAs(t: TestApp, role: OrgRole, orgId: string) {
  const u = await seedUser(t);
  const memberId = await addMember(orgId, u.id, role);
  const agent = await signIn(t, u.email, u.password);
  const r = await agent.post('/v1/auth/organization/set-active').send({ organizationId: orgId });
  if (r.status !== 200) throw new Error(`set-active failed ${r.status}`);
  return { agent, userId: u.id, memberId, email: u.email };
}
export type Agent = ReturnType<typeof supertest.agent>;
