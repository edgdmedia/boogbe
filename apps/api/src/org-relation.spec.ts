import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Tenant models declare a Prisma relation to Organization only so the FK lives in schema.prisma.
 * It must never be written, connected, filtered on, included or selected: creates use scalar fields so
 * the org-scope extension can inject orgId (docs/DATA_MODEL.md, Migration rules).
 */
const tenantModels = Prisma.dmmf.datamodel.models.filter(
  (m) => m.name !== 'JobRun' && m.fields.some((f) => f.name === 'orgId'),
);
const TENANT_DELEGATES = new Set(tenantModels.map((m) => m.name[0]!.toLowerCase() + m.name.slice(1)));
const ORG_KEYS = new Set([
  'organization',
  ...tenantModels.flatMap((m) => m.fields.filter((f) => f.type === 'Organization').map((f) => f.name)),
]);

/** Finds `org`/`organization` keys anywhere inside the arguments of `<x>.<tenantDelegate>.<method>(…)`. */
export function orgRelationMisuse(source: string, file = 'inline.ts'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const keyName = (n: ts.Node) =>
    (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
    (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))
      ? n.name.text
      : undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      TENANT_DELEGATES.has(node.expression.expression.name.text)
    ) {
      const call = `${node.expression.expression.name.text}.${node.expression.name.text}`;
      const walk = (n: ts.Node) => {
        const k = keyName(n);
        if (k && ORG_KEYS.has(k)) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
          found.push(`${file}:${line + 1} ${call} uses \`${k}\``);
        }
        ts.forEachChild(n, walk);
      };
      node.arguments.forEach(walk);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (e === 'node_modules' || e === 'dist') return [];
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('org-relation.spec.ts') ? [p] : [];
  });
}

describe('Organization relation on tenant models (static)', () => {
  it('knows the tenant delegates and their Organization relation name', () => {
    expect(TENANT_DELEGATES.has('unit')).toBe(true);
    expect(TENANT_DELEGATES.has('member')).toBe(false);
    expect(ORG_KEYS.has('org')).toBe(true);
  });

  it('flags writes, connects, filters, includes and selects of the relation', () => {
    const bad = [
      `tx.unit.create({ data: { id, name, org: { connect: { id: orgId } } } })`,
      `tx.property.update({ where: { id }, data: { organization: { connect: { id } } } })`,
      `tx.owner.upsert({ where: { id }, create: { org: { connect: { id } } }, update: {} })`,
      `tx.unit.findMany({ include: { org: true } })`,
      `tx.block.findFirst({ select: { id: true, org: { select: { name: true } } } })`,
      `tx.unit.findMany({ where: { org: { slug: 'x' } } })`,
      `tx.property.create({ data: { units: { create: [{ name: 'A', org: { connect: { id } } }] } } })`,
    ];
    for (const src of bad) expect(orgRelationMisuse(src), src).toHaveLength(1);
  });

  it('allows scalar orgId and Organization on global models', () => {
    const ok = [
      `tx.unit.create({ data: { id, propertyId, name } })`,
      `tx.unit.findMany({ where: { orgId } })`,
      `prisma.member.findFirst({ include: { organization: { select: { status: true } } } })`,
      `prisma.invitation.findMany({ where: { organization: { slug } } })`,
      `const organization = { name: 'x' }`,
    ];
    for (const src of ok) expect(orgRelationMisuse(src), src).toEqual([]);
  });

  it('no code in apps/api (src, test, scripts) touches the relation', () => {
    const root = resolve(__dirname, '..');
    const offenders = ['src', 'test', 'scripts']
      .flatMap((d) => files(join(root, d)))
      .flatMap((f) => orgRelationMisuse(readFileSync(f, 'utf8'), f.slice(root.length + 1)));
    expect(offenders, 'Use scalar orgId; the Organization relation exists only to declare the FK.').toEqual([]);
  });
});
