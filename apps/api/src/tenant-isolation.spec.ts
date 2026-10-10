import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Structural guards for tenant isolation:
 * 1. A service method that accepts `orgId` (or an OrgCtx named `ctx`/`org`) must use it.
 * 2. Only allow-listed folders may inject PrismaService (the unscoped client).
 * Unclutter shipped the first bug class three times; this reads source so untested methods are covered too.
 */
const SRC = resolve(__dirname);
const PRISMA_ALLOWED = [
  'common/db/',
  'common/auth/',
  'common/jobs/',
  'modules/health/',
  'modules/me/',
  'modules/platform/',
  'modules/invitations/',
  'modules/org/', // organization table is global (Better Auth); tenant reads go through OrgDb
];

function files(dir: string, pred: (f: string) => boolean): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? files(p, pred) : pred(p) ? [p] : [];
  });
}

function methods(src: string) {
  const out: { name: string; args: string; body: string }[] = [];
  for (const m of src.matchAll(/ {2}(?:private |protected |public )?async (\w+)\(([\s\S]*?)\)\s*(?::[^{]*)?\{/g)) {
    let depth = 0;
    let body = '';
    for (let i = m.index! + m[0].length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        body = src.slice(m.index! + m[0].length, i);
        break;
      }
    }
    out.push({ name: m[1]!, args: m[2]!.replace(/\s+/g, ' '), body });
  }
  return out;
}

describe('tenant isolation (static)', () => {
  const services = files(join(SRC, 'modules'), (f) => f.endsWith('.service.ts'));

  it('no service method accepts orgId without using it', () => {
    const v: string[] = [];
    for (const f of services) {
      for (const { name, args, body } of methods(readFileSync(f, 'utf8'))) {
        for (const p of ['orgId', 'org:', 'ctx:']) {
          const param = p.replace(':', '');
          if (args.includes(p === 'orgId' ? 'orgId' : p) && !new RegExp(`\\b${param}\\b`).test(body)) {
            v.push(`${f.slice(SRC.length)} -> ${name}`);
          }
        }
      }
    }
    expect(v, 'These methods take an org scope and ignore it. Use it or remove it.').toEqual([]);
  });

  it('only allow-listed folders inject PrismaService', () => {
    const offenders = files(SRC, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) => /PrismaService/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => !PRISMA_ALLOWED.some((a) => rel.startsWith(a)));
    expect(offenders).toEqual([]);
  });

  it('detects a violation when one is present', () => {
    const sample = `
  async ok(orgId: string, id: string) { return x({ where: { id, orgId } }); }
  async leaky(orgId: string, id: string) { return x({ where: { id } }); }`;
    expect(methods(sample).filter((m) => m.args.includes('orgId') && !/\borgId\b/.test(m.body)).map((m) => m.name)).toEqual(
      ['leaky'],
    );
  });
});
