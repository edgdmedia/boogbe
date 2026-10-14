/**
 * Usage: pnpm --filter @boogbe/api create-platform-admin -- you@x.com "Your Name" 'password'
 * Pass `-` as the password to read it from stdin instead, so it never shows in `ps` or shell history:
 *   read -rsp 'Password: ' PW; printf '%s' "$PW" | pnpm … create-platform-admin -- you@x.com "Your Name" -; unset PW
 */
import { PrismaClient } from '@prisma/client';
import { createAuth } from '../src/common/auth/auth';
import { MemoryMailer } from '../src/common/mail/mailer';
import { resolve } from 'node:path';
import { loadDotEnv, loadEnv } from '../src/env';

async function main() {
  const [email, name, arg] = process.argv.slice(2);
  const password = arg === '-' ? await readStdin() : arg;
  if (!email || !name || !password) throw new Error('usage: <email> <name> <password>');
  loadDotEnv(resolve(__dirname, '../../../.env'));
  const env = loadEnv();
  if (!env.PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase())) throw new Error('email must be listed in PLATFORM_ADMIN_EMAILS');
  const prisma = new PrismaClient();
  const auth = createAuth({ prisma, mailer: new MemoryMailer(), env });
  const r = await auth.api.signUpEmail({ body: { email, name, password } });
  await prisma.user.update({ where: { id: r.user.id }, data: { role: 'admin', emailVerified: true } });
  console.log(`platform admin ${email} created`);
  await prisma.$disconnect();
}

async function readStdin(): Promise<string> {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s.replace(/\r?\n$/, '');
}

void main();
