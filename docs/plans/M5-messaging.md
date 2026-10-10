# M5 — Guest Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Claim each task in `docs/COORDINATION.md` before starting.

**Goal:** Editable per-operator templates (email + WhatsApp) with validated placeholders; automatic emails (confirmation, receipt with PDF, check-in details the day before, thanks, deposit returned) through a transactional outbox with retries; one-tap WhatsApp (`wa.me`) with prefilled text; per-booking message log. Exit: E2E-07 passes.

**Architecture:** Template rendering is pure (`packages/shared/src/domain/templates.ts`). Messages are written to `outbound_message` inside the business transaction (outbox) and sent by `MessageDispatchJob` (worker, every minute, `FOR UPDATE SKIP LOCKED`). Triggers hang off `BookingHooks` and `PaymentHooks`; the pre-arrival email is a time-based job. WhatsApp sends are not automated — the app opens `wa.me` and the API logs `whatsapp_opened`.

**Tech Stack:** as M4.

**Spec:** FRD MSG-01..07; decision D-008 (email auto + WhatsApp click), D-020 (outbox).

**Depends on:** M3 (payments hooks, receipt PDF). Can run in parallel with M4.

## Global Constraints

- Template keys: `booking_confirmation`, `payment_receipt`, `check_in_details`, `pre_arrival_reminder`, `post_checkout_thanks`, `deposit_returned`.
- Placeholders (exact): `guest.firstName`, `guest.fullName`, `booking.ref`, `booking.checkIn`, `booking.checkOut`, `booking.nights`, `booking.guests`, `unit.name`, `property.name`, `property.address`, `money.total`, `money.paid`, `money.balance`, `money.deposit`, `money.lastPayment`, `operator.name`, `operator.phone`, `operator.email`, `checkIn.time`, `checkOut.time`, `unit.checkInInstructions`. Syntax `{{ name }}` (spaces optional). Unknown placeholder → 400 on save.
- Email body is a safe Markdown subset: paragraphs, line breaks, `**bold**`, `[text](https://…)`; everything else is escaped text.
- Email From: `"<Operator name> via Boogbe" <MAIL_FROM address>`; Reply-To: operator `contactEmail` when set.
- Outbox retry: up to 3 attempts, backoff 1 min → 5 min → 30 min; then `failed` + admin notification `message_failed`.
- Automatic sends only when the guest has an email **and** the template's `auto_email` is on; each automatic `(booking, template)` email is sent at most once (`dedupe_key`).
- Dates in messages: `9 Oct 2026` (en-NG, operator tz); money via `formatNaira`.

## Review Focus

1. **Guest without an email** → automatic triggers skip silently; manual "Send email" is disabled with a hint (T-M5-05 test `no email, no auto send`).
2. **Booking confirmed twice** (e.g. confirm → cancelled → re-created) must not resend the same confirmation for the same booking (T-M5-05 test `confirmation is sent once per booking`).
3. **Template containing HTML/script** must be escaped in the email (T-M5-01 test `escapes html`).
4. **Resend outage** → message retries then fails visibly on the booking and notifies admins; the user's action (payment, confirm) still succeeds (T-M5-04 test `send failure does not fail the payment`).
5. **Two worker ticks overlapping** must not send the same message twice (T-M5-04 test `skip locked prevents double send`).

## Parallel split

| Task | Track | Agent | Depends on |
|---|---|---|---|
| T-M5-01 Template domain + defaults + contracts | domain | Claude Code | M3 |
| T-M5-02 Schema: templates, outbox | schema | Claude Code | T-M5-01 |
| T-M5-03 Templates API + variables | api | Claude Code | T-M5-02 |
| T-M5-04 Outbox + dispatcher + attachments | api | Claude Code | T-M5-02 |
| T-M5-05 Triggers, pre-arrival job, manual send, WhatsApp log, message log | api | Claude Code | T-M5-03, T-M5-04 |
| T-M5-06 Template editor UI | ui | OpenCode | T-M5-01 (stub), merge after T-M5-03 |
| T-M5-07 Booking messages panel + E2E-07 | ui/e2e | OpenCode | T-M5-05 |

---

### Task 1 (T-M5-01) [domain]: Renderer, Markdown-lite, defaults, contracts

**Files:** Create `packages/shared/src/domain/templates.ts`, `packages/shared/src/domain/template-defaults.ts`, `packages/shared/src/contracts/messages.ts`; modify `index.ts`; Test `packages/shared/src/domain/templates.test.ts`.

**Interfaces (produced):**
```ts
export const TEMPLATE_KEYS = [...] as const; export type TemplateKey
export const PLACEHOLDERS = [...] as const; export type Placeholder
export type TemplateVars = Record<Placeholder, string>
export function findPlaceholders(text: string): string[]
export function unknownPlaceholders(text: string): string[]
export function render(text: string, vars: TemplateVars): string        // missing value → ''
export function markdownToHtml(md: string): string                       // safe subset
export function waLink(e164: string, text: string): string               // https://wa.me/<digits>?text=<encoded>
export const SAMPLE_VARS: TemplateVars
export const DEFAULT_TEMPLATES: Record<TemplateKey, { emailSubject: string; emailBody: string; whatsappBody: string; autoEmail: boolean }>
export const TEMPLATE_LABELS: Record<TemplateKey, string>
// contracts/messages.ts
MessageTemplate { key; label; emailSubject; emailBody; whatsappBody; autoEmail; active; updatedAt }
UpdateTemplateInput { emailSubject (1..150); emailBody (1..5000); whatsappBody (1..1500); autoEmail: boolean; active: boolean } (+ refine no unknown placeholders)
PreviewTemplateInput { emailSubject; emailBody; whatsappBody }
PreviewResponse { emailSubject; emailHtml; whatsappText }
BookingMessagePreview { templateKey; email: { to: string|null; subject; html; text } ; whatsapp: { to: string; text; url } }
SendEmailInput { templateKey; subject?: string; body?: string }
WhatsappOpenedInput { templateKey }
MessageLogEntry { id; templateKey: string|null; channel: 'email'|'whatsapp'; recipient; subject: string|null; status: 'queued'|'sent'|'failed'|'whatsapp_opened'; attempts; error: string|null; actorName: string|null; createdAt; sentAt: string|null }
```

- [ ] **Step 1: Failing tests** `packages/shared/src/domain/templates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, markdownToHtml, render, SAMPLE_VARS, TEMPLATE_KEYS, unknownPlaceholders, waLink } from './templates';

describe('templates [MSG-02]', () => {
  it('renders known placeholders with optional spaces', () => {
    expect(render('Hi {{guest.firstName}}, ref {{ booking.ref }}.', { ...SAMPLE_VARS, 'guest.firstName': 'Ada', 'booking.ref': 'TAN-2610-0001' })).toBe('Hi Ada, ref TAN-2610-0001.');
  });
  it('reports unknown placeholders', () => {
    expect(unknownPlaceholders('Hi {{guest.firstName}} {{guest.lastname}} {{ foo }}')).toEqual(['guest.lastname', 'foo']);
  });
  it('every default template uses only known placeholders', () => {
    for (const k of TEMPLATE_KEYS) {
      const t = DEFAULT_TEMPLATES[k];
      expect(unknownPlaceholders(t.emailSubject + t.emailBody + t.whatsappBody), k).toEqual([]);
    }
  });
});

describe('markdownToHtml', () => {
  it('supports paragraphs, line breaks, bold and https links', () => {
    expect(markdownToHtml('Hello **Ada**\nSee [map](https://maps.google.com/x)\n\nBye')).toBe(
      '<p>Hello <strong>Ada</strong><br>See <a href="https://maps.google.com/x">map</a></p><p>Bye</p>');
  });
  it('escapes html', () => {
    expect(markdownToHtml('<script>alert(1)</script> & "x"')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>');
  });
  it('refuses non-https links', () => {
    expect(markdownToHtml('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
  });
});

describe('waLink [MSG-04]', () => {
  it('builds a wa.me link with encoded text', () => {
    expect(waLink('+2348107548559', 'Hi Ada & co\nSee you')).toBe('https://wa.me/2348107548559?text=Hi%20Ada%20%26%20co%0ASee%20you');
  });
});
```
- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implement** `packages/shared/src/domain/templates.ts`:
```ts
import { waDigits } from './phone';

export const TEMPLATE_KEYS = ['booking_confirmation', 'payment_receipt', 'check_in_details', 'pre_arrival_reminder', 'post_checkout_thanks', 'deposit_returned'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  booking_confirmation: 'Booking confirmation', payment_receipt: 'Payment receipt', check_in_details: 'Check-in details',
  pre_arrival_reminder: 'Pre-arrival reminder', post_checkout_thanks: 'Thank you after checkout', deposit_returned: 'Deposit returned',
};
export const PLACEHOLDERS = [
  'guest.firstName', 'guest.fullName', 'booking.ref', 'booking.checkIn', 'booking.checkOut', 'booking.nights', 'booking.guests',
  'unit.name', 'property.name', 'property.address', 'money.total', 'money.paid', 'money.balance', 'money.deposit', 'money.lastPayment',
  'operator.name', 'operator.phone', 'operator.email', 'checkIn.time', 'checkOut.time', 'unit.checkInInstructions',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateVars = Record<Placeholder, string>;

const RE = /\{\{\s*([\w.]+)\s*\}\}/g;
export const findPlaceholders = (t: string) => [...t.matchAll(RE)].map((m) => m[1]!);
export const unknownPlaceholders = (t: string) => [...new Set(findPlaceholders(t).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p)))];
export const render = (t: string, vars: TemplateVars) => t.replace(RE, (_, k: string) => (vars as Record<string, string>)[k] ?? '');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function markdownToHtml(md: string): string {
  return md.trim().split(/\n{2,}/).map((para) => {
    let h = esc(para);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, text: string, url: string) => `<a href="${url}">${text}</a>`);
    return `<p>${h.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}
export const waLink = (e164: string, text: string) => `https://wa.me/${waDigits(e164)}?text=${encodeURIComponent(text)}`;

export const SAMPLE_VARS: TemplateVars = {
  'guest.firstName': 'Adaeze', 'guest.fullName': 'Adaeze Okafor', 'booking.ref': 'TAN-2610-0042', 'booking.checkIn': '1 Nov 2026', 'booking.checkOut': '4 Nov 2026',
  'booking.nights': '3', 'booking.guests': '2', 'unit.name': 'Kairo', 'property.name': 'The Rock Apartments', 'property.address': '3 Olu-Babajide Close, Lekki Phase 1',
  'money.total': '₦615,000', 'money.paid': '₦300,000', 'money.balance': '₦315,000', 'money.deposit': '₦100,000', 'money.lastPayment': '₦300,000',
  'operator.name': 'Tanuhomes', 'operator.phone': '+234 810 754 8559', 'operator.email': 'hello@tanuhomes.com', 'checkIn.time': '2:00 pm', 'checkOut.time': '12:00 pm',
  'unit.checkInInstructions': 'The gate code is 4821. Your key is in the lockbox by the door.',
};
export { DEFAULT_TEMPLATES } from './template-defaults';
```
`packages/shared/src/domain/template-defaults.ts`:
```ts
import type { TemplateKey } from './templates';

export const DEFAULT_TEMPLATES: Record<TemplateKey, { emailSubject: string; emailBody: string; whatsappBody: string; autoEmail: boolean }> = {
  booking_confirmation: {
    emailSubject: 'Your stay at {{unit.name}} is confirmed ({{booking.ref}})',
    emailBody: 'Hi {{guest.firstName}},\n\nYour booking is confirmed.\n\n**{{unit.name}}**, {{property.name}}\n{{booking.checkIn}} – {{booking.checkOut}} ({{booking.nights}} nights, {{booking.guests}} guests)\n\nTotal: {{money.total}}\nPaid: {{money.paid}}\nBalance: {{money.balance}}\nRefundable caution deposit: {{money.deposit}}\n\nCheck-in from {{checkIn.time}}. Check-out by {{checkOut.time}}.\n\nQuestions? Call or WhatsApp {{operator.phone}}.\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, your stay at {{unit.name}} ({{booking.checkIn}} – {{booking.checkOut}}) is confirmed. Ref {{booking.ref}}. Total {{money.total}}, paid {{money.paid}}, balance {{money.balance}}. Check-in from {{checkIn.time}}. – {{operator.name}}',
    autoEmail: true,
  },
  payment_receipt: {
    emailSubject: 'Payment received – {{booking.ref}}',
    emailBody: 'Hi {{guest.firstName}},\n\nWe received {{money.lastPayment}} for your stay at {{unit.name}} ({{booking.checkIn}} – {{booking.checkOut}}).\n\nBalance remaining: {{money.balance}}\n\nYour receipt is attached.\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, we received {{money.lastPayment}} for {{booking.ref}}. Balance remaining: {{money.balance}}. Thank you! – {{operator.name}}',
    autoEmail: true,
  },
  check_in_details: {
    emailSubject: 'Check-in details for tomorrow – {{unit.name}}',
    emailBody: 'Hi {{guest.firstName}},\n\nWe look forward to welcoming you tomorrow.\n\n**Address:** {{property.address}}\n**Check-in from:** {{checkIn.time}}\n\n{{unit.checkInInstructions}}\n\nBalance to pay before check-in: {{money.balance}}\n\nCall or WhatsApp {{operator.phone}} when you are on your way.\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, see you tomorrow at {{unit.name}}, {{property.address}}. Check-in from {{checkIn.time}}.\n\n{{unit.checkInInstructions}}\n\nBalance due: {{money.balance}}. – {{operator.name}}',
    autoEmail: true,
  },
  pre_arrival_reminder: {
    emailSubject: 'Your stay is coming up – {{booking.ref}}',
    emailBody: 'Hi {{guest.firstName}},\n\nA reminder that your stay at {{unit.name}} starts on {{booking.checkIn}}.\n\nBalance: {{money.balance}}\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, a reminder that your stay at {{unit.name}} starts {{booking.checkIn}}. Balance: {{money.balance}}. – {{operator.name}}',
    autoEmail: false,
  },
  post_checkout_thanks: {
    emailSubject: 'Thank you for staying with {{operator.name}}',
    emailBody: 'Hi {{guest.firstName}},\n\nThank you for staying at {{unit.name}}. We hope you enjoyed it and would love to host you again.\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, thank you for staying at {{unit.name}}! We would love to host you again. – {{operator.name}}',
    autoEmail: true,
  },
  deposit_returned: {
    emailSubject: 'Your caution deposit has been returned – {{booking.ref}}',
    emailBody: 'Hi {{guest.firstName}},\n\nWe have returned your caution deposit for {{booking.ref}}. Please allow a little time for the transfer to arrive.\n\n{{operator.name}}',
    whatsappBody: 'Hi {{guest.firstName}}, we have returned your caution deposit for {{booking.ref}}. – {{operator.name}}',
    autoEmail: true,
  },
};
```
`packages/shared/src/contracts/messages.ts`:
```ts
import { z } from 'zod';
import { TEMPLATE_KEYS, unknownPlaceholders } from '../domain/templates';

export const TemplateKeyEnum = z.enum(TEMPLATE_KEYS);
const noUnknown = (v: { emailSubject: string; emailBody: string; whatsappBody: string }, ctx: z.RefinementCtx) => {
  for (const f of ['emailSubject', 'emailBody', 'whatsappBody'] as const) {
    const bad = unknownPlaceholders(v[f]);
    if (bad.length) ctx.addIssue({ code: 'custom', path: [f], message: `Unknown placeholder: ${bad.map((b) => `{{${b}}}`).join(', ')}` });
  }
};
export const MessageTemplate = z.object({
  key: TemplateKeyEnum, label: z.string(), emailSubject: z.string(), emailBody: z.string(), whatsappBody: z.string(),
  autoEmail: z.boolean(), active: z.boolean(), updatedAt: z.string(),
});
export type MessageTemplate = z.infer<typeof MessageTemplate>;
export const UpdateTemplateInput = z.object({
  emailSubject: z.string().trim().min(1).max(150), emailBody: z.string().trim().min(1).max(5000), whatsappBody: z.string().trim().min(1).max(1500),
  autoEmail: z.boolean(), active: z.boolean(),
}).superRefine(noUnknown);
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateInput>;
export const PreviewTemplateInput = z.object({ emailSubject: z.string(), emailBody: z.string(), whatsappBody: z.string() }).superRefine(noUnknown);
export const PreviewResponse = z.object({ emailSubject: z.string(), emailHtml: z.string(), whatsappText: z.string() });
export const BookingMessagePreview = z.object({
  templateKey: TemplateKeyEnum,
  email: z.object({ to: z.string().nullable(), subject: z.string(), html: z.string(), text: z.string() }),
  whatsapp: z.object({ to: z.string(), text: z.string(), url: z.string() }),
});
export type BookingMessagePreview = z.infer<typeof BookingMessagePreview>;
export const SendEmailInput = z.object({ templateKey: TemplateKeyEnum, subject: z.string().trim().min(1).max(150).optional(), body: z.string().trim().min(1).max(5000).optional() });
export const WhatsappOpenedInput = z.object({ templateKey: TemplateKeyEnum });
export const MessageLogEntry = z.object({
  id: z.string(), templateKey: z.string().nullable(), channel: z.enum(['email', 'whatsapp']), recipient: z.string(), subject: z.string().nullable(),
  status: z.enum(['queued', 'sent', 'failed', 'whatsapp_opened']), attempts: z.number().int(), error: z.string().nullable(),
  actorName: z.string().nullable(), createdAt: z.string(), sentAt: z.string().nullable(),
});
export type MessageLogEntry = z.infer<typeof MessageLogEntry>;
```
Export `domain/templates` and `contracts/messages` from `index.ts`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(shared): template rendering, safe markdown, wa.me links, default templates [MSG-01 MSG-02 MSG-04]"`

---

### Task 2 (T-M5-02) [schema]: Templates and outbox

**Files:** `prisma/schema.prisma`, `prisma/migrations/0007_messaging/migration.sql`. (Behaviour tested in T-M5-03/04.)

- [ ] **Step 1: Schema**
```prisma
model MessageTemplate {
  id           String   @id
  orgId        String   @map("org_id")
  key          String
  emailSubject String   @map("email_subject")
  emailBody    String   @map("email_body")
  whatsappBody String   @map("whatsapp_body")
  autoEmail    Boolean  @map("auto_email")
  active       Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([orgId, key])
  @@map("message_template")
}

model OutboundMessage {
  id            String    @id
  orgId         String    @map("org_id")
  bookingId     String?   @map("booking_id")
  paymentId     String?   @map("payment_id")
  templateKey   String?   @map("template_key")
  channel       String
  recipient     String
  subject       String?
  bodyText      String    @map("body_text")
  bodyHtml      String?   @map("body_html")
  replyTo       String?   @map("reply_to")
  fromName      String?   @map("from_name")
  status        String
  attempts      Int       @default(0)
  nextAttemptAt DateTime? @map("next_attempt_at")
  providerId    String?   @map("provider_id")
  error         String?
  dedupeKey     String?   @map("dedupe_key")
  actorMemberId String?   @map("actor_member_id")
  createdAt     DateTime  @default(now()) @map("created_at")
  sentAt        DateTime? @map("sent_at")

  @@unique([orgId, dedupeKey])
  @@index([status, nextAttemptAt])
  @@index([orgId, bookingId, createdAt])
  @@map("outbound_message")
}
```
- [ ] **Step 2: Migration SQL** (append):
```sql
ALTER TABLE message_template ADD CONSTRAINT message_template_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE outbound_message ADD CONSTRAINT outbound_message_org_fk FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE CASCADE;
ALTER TABLE outbound_message ADD CONSTRAINT outbound_message_booking_fk FOREIGN KEY (booking_id) REFERENCES booking(id);
ALTER TABLE outbound_message ADD CONSTRAINT outbound_message_channel_chk CHECK (channel IN ('email','whatsapp'));
ALTER TABLE outbound_message ADD CONSTRAINT outbound_message_status_chk CHECK (status IN ('queued','sent','failed','whatsapp_opened'));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_template','outbound_message'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
```
- [ ] **Step 3:** `pnpm db:reset && pnpm --filter @boogbe/api prisma:generate && pnpm test:int` (RLS coverage) → PASS.
- [ ] **Step 4: Commit** `git commit -m "feat(db): message templates and outbound message outbox [MSG-01 MSG-05]"`

---

### Task 3 (T-M5-03) [api]: Templates API and message variables

**Files:** Create `apps/api/src/modules/messaging/{messaging.module.ts,templates.controller.ts,templates.service.ts,vars.service.ts}`; Test `apps/api/test/templates.int.ts`.

**Interfaces:**
- `TemplatesService.ensureDefaults(tx): Promise<void>` (inserts any missing keys from `DEFAULT_TEMPLATES`); `getIn(tx, key): Promise<MessageTemplate>`; `list(ctx)`; `update(ctx, key, input)`; `preview(ctx, input): PreviewResponse` (with `SAMPLE_VARS`, but operator vars from the real org).
- `VarsService.forBooking(tx, orgId, bookingId, opts?: { lastPaymentKobo?: number }): Promise<TemplateVars>` — uses `BookingsService.getIn` (decorated with money), `OrgInfo.get`, `org_settings` times (format `14:00` → `2:00 pm`), unit `checkInInstructions`, property name/address.
- Endpoints: `GET /v1/templates` (`messages.read`) → `{ items: MessageTemplate[] }`; `PUT /v1/templates/:key` (`templates.write`) body `UpdateTemplateInput`; `POST /v1/templates/preview` (`messages.read`) body `PreviewTemplateInput` → `PreviewResponse`.

- [ ] **Step 1: Failing test** `apps/api/test/templates.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';

describe('templates [MSG-01 MSG-02]', () => {
  let t: TestApp; let admin: Agent; let orgId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg('Tanuhomes')).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    await m.end();
    admin = (await signInAs(t, 'admin', orgId)).agent;
  });

  it('lists the six defaults on first use', async () => {
    const r = (await admin.get('/v1/templates').expect(200)).body.items;
    expect(r.map((x: { key: string }) => x.key)).toEqual(['booking_confirmation', 'payment_receipt', 'check_in_details', 'pre_arrival_reminder', 'post_checkout_thanks', 'deposit_returned']);
  });

  it('rejects unknown placeholders and saves valid edits', async () => {
    const base = { emailSubject: 'Hi', emailBody: 'Hello {{guest.nickname}}', whatsappBody: 'x', autoEmail: true, active: true };
    const bad = await admin.put('/v1/templates/booking_confirmation').send(base);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('{{guest.nickname}}');
    await admin.put('/v1/templates/booking_confirmation').send({ ...base, emailBody: 'Hello {{guest.firstName}}' }).expect(200);
  });

  it('previews with sample data and the real operator name', async () => {
    const r = (await admin.post('/v1/templates/preview').send({ emailSubject: '{{operator.name}}', emailBody: 'Hi **{{guest.firstName}}**', whatsappBody: '{{booking.ref}}' }).expect(200)).body;
    expect(r).toEqual({ emailSubject: 'Tanuhomes', emailHtml: '<p>Hi <strong>Adaeze</strong></p>', whatsappText: 'TAN-2610-0042' });
  });

  it('frontdesk can read but not edit', async () => {
    const fd = (await signInAs(t, 'frontdesk', orgId)).agent;
    await fd.get('/v1/templates').expect(200);
    await fd.put('/v1/templates/booking_confirmation').send({ emailSubject: 'x', emailBody: 'x', whatsappBody: 'x', autoEmail: true, active: true }).expect(403);
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `templates.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DEFAULT_TEMPLATES, markdownToHtml, render, SAMPLE_VARS, TEMPLATE_KEYS, TEMPLATE_LABELS, type MessageTemplate, type TemplateKey, type UpdateTemplateInput } from '@boogbe/shared';
import type { MessageTemplate as Row } from '@prisma/client';
import { OrgDb, type OrgTx } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { newId } from '../../common/db/ids';
import { AuditService } from '../../common/audit/audit.service';
import type { OrgCtx } from '../../common/auth/request-ctx';

const toTemplate = (r: Row): MessageTemplate => ({ key: r.key as TemplateKey, label: TEMPLATE_LABELS[r.key as TemplateKey], emailSubject: r.emailSubject, emailBody: r.emailBody, whatsappBody: r.whatsappBody, autoEmail: r.autoEmail, active: r.active, updatedAt: r.updatedAt.toISOString() });

@Injectable()
export class TemplatesService {
  constructor(private readonly orgDb: OrgDb, private readonly audit: AuditService, private readonly orgInfo: OrgInfo) {}

  async ensureDefaults(tx: OrgTx) {
    const have = new Set((await tx.messageTemplate.findMany({ select: { key: true } })).map((r) => r.key));
    const missing = TEMPLATE_KEYS.filter((k) => !have.has(k));
    if (missing.length) await tx.messageTemplate.createMany({ data: missing.map((k) => ({ id: newId(), key: k, ...DEFAULT_TEMPLATES[k] })) as never, skipDuplicates: true });
  }

  async getIn(tx: OrgTx, key: TemplateKey): Promise<MessageTemplate> {
    await this.ensureDefaults(tx);
    return toTemplate((await tx.messageTemplate.findFirst({ where: { key } }))!);
  }

  list(ctx: OrgCtx) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      await this.ensureDefaults(tx);
      const rows = await tx.messageTemplate.findMany();
      return { items: TEMPLATE_KEYS.map((k) => toTemplate(rows.find((r) => r.key === k)!)) };
    });
  }

  update(ctx: OrgCtx, key: TemplateKey, input: UpdateTemplateInput) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const before = await this.getIn(tx, key);
      await tx.messageTemplate.updateMany({ where: { key }, data: input });
      await this.audit.record(tx, { actor: ctx, action: 'template.update', entity: 'message_template', entityId: key, before, after: input });
      return this.getIn(tx, key);
    });
  }

  async preview(ctx: OrgCtx, input: { emailSubject: string; emailBody: string; whatsappBody: string }) {
    const org = await this.orgInfo.get(ctx.orgId);
    const vars = { ...SAMPLE_VARS, 'operator.name': org.name, ...(org.phone && { 'operator.phone': org.phone }), ...(org.email && { 'operator.email': org.email }) };
    return { emailSubject: render(input.emailSubject, vars), emailHtml: markdownToHtml(render(input.emailBody, vars)), whatsappText: render(input.whatsappBody, vars) };
  }
}
```
`vars.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { formatNaira, nightsBetween, type TemplateVars } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { BookingsService } from '../bookings/bookings.service';

const date = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const time = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`; };

@Injectable()
export class VarsService {
  constructor(private readonly bookings: BookingsService, private readonly orgInfo: OrgInfo) {}

  async forBooking(tx: OrgTx, orgId: string, bookingId: string, opts: { lastPaymentKobo?: number } = {}): Promise<TemplateVars> {
    const b = await this.bookings.getIn(tx, orgId, bookingId);
    const unit = await tx.unit.findFirstOrThrow({ where: { id: b.unit.id }, include: { property: true } });
    const s = await tx.orgSettings.findFirstOrThrow();
    const org = await this.orgInfo.get(orgId);
    return {
      'guest.firstName': b.guest.fullName.split(/\s+/)[0] ?? b.guest.fullName, 'guest.fullName': b.guest.fullName,
      'booking.ref': b.ref, 'booking.checkIn': date(b.checkIn), 'booking.checkOut': date(b.checkOut),
      'booking.nights': String(nightsBetween(b.checkIn, b.checkOut)), 'booking.guests': String(b.guestCount),
      'unit.name': unit.name, 'property.name': unit.property.name, 'property.address': unit.property.address,
      'money.total': formatNaira(b.finalTotalKobo), 'money.paid': formatNaira(b.paidKobo ?? 0), 'money.balance': formatNaira(Math.max(0, b.balanceKobo ?? b.finalTotalKobo)),
      'money.deposit': formatNaira(b.depositKobo), 'money.lastPayment': formatNaira(opts.lastPaymentKobo ?? 0),
      'operator.name': org.name, 'operator.phone': org.phone ?? '', 'operator.email': org.email ?? '',
      'checkIn.time': time(s.checkInTime), 'checkOut.time': time(s.checkOutTime), 'unit.checkInInstructions': unit.checkInInstructions ?? '',
    };
  }
}
```
Controller `templates.controller.ts` (`@Controller('templates')`): `GET` (`messages.read`), `POST preview` (`messages.read`, `@HttpCode(200)`, declared **before** `PUT :key`), `PUT :key` (`templates.write`; `@Param('key', new ZodValidationPipe(TemplateKeyEnum))`). `MessagingModule` (`@Global`) provides `TemplatesService`, `VarsService`; register in `AppModule` and `WorkerModule`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(messaging): template defaults, editing with placeholder validation, preview [MSG-01 MSG-02]"`

---

### Task 4 (T-M5-04) [api]: Outbox, dispatcher, attachments, failure alerts

**Files:** Create `apps/api/src/modules/messaging/{outbox.service.ts,message-dispatch.job.ts}`; modify `apps/api/src/common/mail/mailer.ts` (attachments + provider id); Test `apps/api/test/outbox.int.ts`.

**Interfaces:**
- `MailMessage` gains `attachments?: { filename: string; content: Buffer }[]`; `Mailer.send` returns `Promise<{ id: string | null }>` (`ResendMailer` returns `data.id`; `MemoryMailer` returns `{ id: 'mem-<n>' }`). Add `MemoryMailer.failNext(n: number)` for tests (throws `Error('simulated outage')` for the next `n` sends).
- `OutboxService.queueEmail(tx: OrgTx, m: { bookingId?: string; paymentId?: string; templateKey?: TemplateKey; to: string; subject: string; bodyMarkdown: string; dedupeKey?: string; actorMemberId?: string | null }): Promise<{ id: string } | null>` (returns `null` when the dedupe key already exists); `logWhatsapp(tx, { bookingId, templateKey, to, text, actorMemberId })`.
- `MessageDispatchJob.run(now?)` — every minute; global (not per-org) claim query using `FOR UPDATE SKIP LOCKED` inside a transaction per message **with `app.org_id` set to that message's org** (claim via a SECURITY DEFINER function `claim_outbound(limit int)` that returns `(id, org_id)` and marks them `attempts = attempts + 1, next_attempt_at = now() + interval '10 minutes'` as a lease; then each send runs in `OrgDb.run(org_id)`).
- Receipt attachment: when `payment_id` is set, regenerate the receipt PDF via `PaymentsService.receipt` (needs an `OrgCtx`-less variant: add `PaymentsService.receiptForOrg(orgId, paymentId)`).
- On final failure: `status='failed'`, `error`; `notifyRoles(admin, frontdesk)` kind `message_failed` with link to the booking, `dedupeKey: message-failed-<id>`.

- [ ] **Step 1: Migration addition** (new migration `0008_outbox_claim`):
```sql
CREATE OR REPLACE FUNCTION claim_outbound(p_limit int)
RETURNS TABLE (id text, org_id text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbound_message m SET attempts = m.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE m.id IN (
    SELECT o.id FROM outbound_message o JOIN organization g ON g.id = o.org_id
    WHERE o.status = 'queued' AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= now()) AND g.status = 'active'
    ORDER BY o.created_at LIMIT p_limit FOR UPDATE OF o SKIP LOCKED)
  RETURNING m.id, m.org_id
$$;
ALTER FUNCTION claim_outbound(int) OWNER TO boogbe_migrator;
REVOKE ALL ON FUNCTION claim_outbound(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_outbound(int) TO boogbe_app;
```
(Owner `boogbe_migrator` has `BYPASSRLS`, so the claim sees every org; it returns ids only, and the actual send reads the row under that org's RLS context.)

- [ ] **Step 2: Failing test** `apps/api/test/outbox.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs } from './helpers/users';
import { seedBooking, seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { OrgDb } from '../src/common/db/org-db.service';
import { OutboxService } from '../src/modules/messaging/outbox.service';
import { MessageDispatchJob } from '../src/modules/messaging/message-dispatch.job';
import { MAILER } from '../src/common/mail/mail.module';
import type { MemoryMailer } from '../src/common/mail/mailer';
import { WorkerModule } from '../src/worker.module';

describe('outbox [MSG-03 MSG-05 MSG-06]', () => {
  let t: TestApp; let orgId: string; let bookingId: string;
  let job: MessageDispatchJob; let mailer: MemoryMailer; let closeWorker: () => Promise<void>;
  beforeAll(async () => {
    t = await createTestApp();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile(); await mod.init();
    job = mod.get(MessageDispatchJob); mailer = mod.get(MAILER); closeWorker = () => mod.close();
  });
  afterAll(async () => { await closeWorker(); await t.close(); });
  beforeEach(async () => {
    await truncateAll(); mailer.sent.length = 0;
    orgId = (await seedOrg('Tanuhomes')).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    await m.query(`update organization set contact_email='hello@tanuhomes.com' where id=$1`, [orgId]);
    await m.end();
    bookingId = await seedBooking(orgId, await seedUnit(orgId, await seedProperty(orgId)), await seedGuest(orgId), { checkIn: '2026-11-01', checkOut: '2026-11-03' });
  });
  const queue = (dedupeKey?: string) => t.app.get(OrgDb).run(orgId, (tx) => t.app.get(OutboxService).queueEmail(tx, { bookingId, templateKey: 'booking_confirmation', to: 'ada@example.ng', subject: 'Hi', bodyMarkdown: 'Hello **Ada**', dedupeKey }));

  it('sends queued mail with operator name and reply-to', async () => {
    await queue();
    await job.run();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'ada@example.ng', subject: 'Hi', html: '<p>Hello <strong>Ada</strong></p>', fromName: 'Tanuhomes', replyTo: 'hello@tanuhomes.com' });
  });

  it('dedupe key prevents a second queue', async () => {
    expect(await queue('k1')).not.toBeNull();
    expect(await queue('k1')).toBeNull();
  });

  it('retries with backoff, then fails and alerts', async () => {
    const admin = await signInAs(t, 'admin', orgId);
    await queue();
    mailer.failNext(3);
    const m = await migratorClient();
    for (let i = 0; i < 3; i++) { await job.run(); await m.query(`update outbound_message set next_attempt_at = now() - interval '1 second'`); }
    const { rows } = await m.query(`select status, attempts, error from outbound_message`);
    await m.end();
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 3, error: 'simulated outage' });
    expect((await admin.agent.get('/v1/notifications').expect(200)).body.items.some((n: { kind: string }) => n.kind === 'message_failed')).toBe(true);
  });

  it('skip locked prevents double send', async () => {
    await queue();
    await Promise.all([job.run(), job.run(), job.run()]);
    expect(mailer.sent).toHaveLength(1);
  });
});
```
- [ ] **Step 3:** FAIL.
- [ ] **Step 4: Implement**

`mailer.ts` changes: `send(m): Promise<{ id: string | null }>`; `ResendMailer.send` passes `attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content }))` and returns `{ id: data?.id ?? null }`; `MemoryMailer`:
```ts
  private failures = 0; private n = 0;
  failNext(n: number) { this.failures = n; }
  async send(m: MailMessage) {
    if (this.failures > 0) { this.failures--; throw new Error('simulated outage'); }
    this.sent.push(m); return { id: `mem-${++this.n}` };
  }
```
Update existing callers (`sendResetPassword`, invites, `AlertMailer`) — they ignore the return value; no change needed beyond types.

`outbox.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { markdownToHtml, type TemplateKey } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { newId } from '../../common/db/ids';

@Injectable()
export class OutboxService {
  async queueEmail(tx: OrgTx, m: { bookingId?: string; paymentId?: string; templateKey?: TemplateKey; to: string; subject: string; bodyMarkdown: string; dedupeKey?: string; actorMemberId?: string | null }) {
    if (m.dedupeKey && (await tx.outboundMessage.findFirst({ where: { dedupeKey: m.dedupeKey } }))) return null;
    const id = newId();
    await tx.outboundMessage.create({ data: {
      id, bookingId: m.bookingId ?? null, paymentId: m.paymentId ?? null, templateKey: m.templateKey ?? null, channel: 'email', recipient: m.to,
      subject: m.subject, bodyText: m.bodyMarkdown.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https:[^)]+)\)/g, '$1 ($2)'), bodyHtml: markdownToHtml(m.bodyMarkdown),
      status: 'queued', dedupeKey: m.dedupeKey ?? null, actorMemberId: m.actorMemberId ?? null,
    } as never });
    return { id };
  }

  async logWhatsapp(tx: OrgTx, m: { bookingId: string; templateKey: TemplateKey; to: string; text: string; actorMemberId: string | null }) {
    await tx.outboundMessage.create({ data: { id: newId(), bookingId: m.bookingId, templateKey: m.templateKey, channel: 'whatsapp', recipient: m.to, bodyText: m.text, status: 'whatsapp_opened', actorMemberId: m.actorMemberId, sentAt: new Date() } as never });
  }
}
```
(The pre-insert dedupe check plus the `@@unique([orgId, dedupeKey])` constraint covers races: wrap the `create` in try/catch on `P2002` and return `null`.)

`message-dispatch.job.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrgDb } from '../../common/db/org-db.service';
import { OrgInfo } from '../../common/db/org-info';
import { PrismaService } from '../../common/db/prisma.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { MAILER } from '../../common/mail/mail.module';
import type { Mailer } from '../../common/mail/mailer';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';

const BACKOFF_MIN = [1, 5, 30];

@Injectable()
export class MessageDispatchJob {
  private readonly log = new Logger('MessageDispatch');
  constructor(
    private readonly prisma: PrismaService, private readonly orgDb: OrgDb, private readonly orgInfo: OrgInfo, private readonly runner: JobRunner,
    private readonly notifications: NotificationsService, private readonly payments: PaymentsService, @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  @Cron('* * * * *')
  async tick() { await this.runner.once('messaging.dispatch', () => this.run()); }

  async run() {
    const claimed = await this.prisma.$queryRaw<{ id: string; org_id: string }[]>`SELECT * FROM claim_outbound(20)`;
    for (const c of claimed) await this.sendOne(c.org_id, c.id);
  }

  private async sendOne(orgId: string, id: string) {
    const msg = await this.orgDb.run(orgId, (tx) => tx.outboundMessage.findFirst({ where: { id } }));
    if (!msg || msg.status !== 'queued') return;
    const org = await this.orgInfo.get(orgId);
    try {
      const attachments = msg.paymentId ? [await this.payments.receiptForOrg(orgId, msg.paymentId)].map((r) => ({ filename: r.filename, content: r.pdf })) : undefined;
      const r = await this.mailer.send({ to: msg.recipient, subject: msg.subject ?? '', text: msg.bodyText, html: msg.bodyHtml ?? msg.bodyText, fromName: org.name, replyTo: org.email ?? undefined, attachments });
      await this.orgDb.run(orgId, (tx) => tx.outboundMessage.updateMany({ where: { id }, data: { status: 'sent', sentAt: new Date(), providerId: r.id, error: null } }));
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      await this.orgDb.run(orgId, async (tx) => {
        if (msg.attempts >= 3) {
          await tx.outboundMessage.updateMany({ where: { id }, data: { status: 'failed', error } });
          await this.notifications.notifyRoles(tx, orgId, ['admin', 'frontdesk'], { kind: 'message_failed', title: `Email to ${msg.recipient} failed`, body: error, link: msg.bookingId ? `/bookings/${msg.bookingId}` : undefined, dedupeKey: `message-failed-${id}` });
        } else {
          await tx.outboundMessage.updateMany({ where: { id }, data: { error, nextAttemptAt: new Date(Date.now() + BACKOFF_MIN[msg.attempts - 1]! * 60_000) } });
        }
      });
      this.log.warn(`message ${id} attempt ${msg.attempts} failed: ${error}`);
    }
  }
}
```
(`claim_outbound` already incremented `attempts`, so `msg.attempts` is the attempt number being made; backoff index `attempts − 1`. Remove the `+ ' '` concerns: `MessageDispatchJob` uses `PrismaService` only to call the claim function → add `'modules/messaging/message-dispatch.job.ts'` to `PRISMA_ALLOWED` with comment "cross-org claim via security definer".)

`PaymentsService.receiptForOrg(orgId, paymentId)` — refactor `receipt(ctx, id)` to delegate to it (it only needs `orgId`).

Register `OutboxService` in `MessagingModule` (export it) and `MessageDispatchJob` in `WorkerModule.providers`.

- [ ] **Step 5:** PASS. **Step 6: Commit** `git commit -m "feat(messaging): transactional email outbox with skip-locked dispatch, retries, receipt attachments [MSG-03 MSG-05 MSG-06]"`

---

### Task 5 (T-M5-05) [api]: Triggers, pre-arrival job, manual send, WhatsApp log, message log

**Files:** Create `apps/api/src/modules/messaging/{triggers.service.ts,pre-arrival.job.ts,booking-messages.controller.ts,booking-messages.service.ts}`; Test `apps/api/test/messaging-triggers.int.ts`.

**Interfaces:**
- `TriggersService` (on init registers hooks):
  - `BookingHooks.afterCreate` with status `confirmed`, and `afterTransition` to `confirmed` → `booking_confirmation` (`dedupeKey: auto-booking_confirmation-<bookingId>`).
  - `afterTransition` to `checked_out` → `post_checkout_thanks` (`auto-post_checkout_thanks-<id>`).
  - `PaymentHooks.afterRecord` kind `payment` / `deposit_received` → `payment_receipt` with `paymentId` (dedupe per payment `auto-payment_receipt-<paymentId>`); kind `deposit_returned` → `deposit_returned` (`auto-deposit_returned-<paymentId>`).
  - Each: skip if guest has no email, template inactive, or `autoEmail` false.
- `PreArrivalJob` hourly: per active org, if local hour is 10 (`Intl` in org tz), for bookings `status IN (confirmed)` with `check_in = tomorrow(local)` queue `check_in_details` (`auto-check_in_details-<id>`).
- Endpoints (all under `/v1/bookings/:id/messages`):
  - `GET ?templateKey=` (`messages.read`) → `BookingMessagePreview` (rendered with live vars; `email.to` null when no email).
  - `GET /log` (`messages.read`) → `{ items: MessageLogEntry[] }`.
  - `POST /email` (`messages.send`) body `SendEmailInput` → `MessageLogEntry` (manual: no dedupe; 400 if no guest email).
  - `POST /whatsapp-opened` (`messages.send`) body `WhatsappOpenedInput` → `{ ok: true }`.

- [ ] **Step 1: Failing tests** `apps/api/test/messaging-triggers.int.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { migratorClient, truncateAll } from './helpers/db';
import { seedOrg, signInAs, type Agent } from './helpers/users';
import { seedGuest, seedProperty, seedUnit } from './helpers/inventory';
import { PreArrivalJob } from '../src/modules/messaging/pre-arrival.job';

async function outbox(orgId: string) {
  const m = await migratorClient();
  const { rows } = await m.query(`select template_key, recipient, status, dedupe_key, channel from outbound_message where org_id=$1 order by created_at`, [orgId]);
  await m.end(); return rows;
}

describe('message triggers [MSG-03 MSG-04 MSG-05]', () => {
  let t: TestApp; let fd: Agent; let orgId: string; let unitId: string;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => {
    await truncateAll(); orgId = (await seedOrg('Tanuhomes')).id;
    const m = await migratorClient();
    await m.query(`insert into org_settings(org_id, receipt_prefix, statement_prefix, booking_prefix, updated_at) values ($1,'T','T','T',now())`, [orgId]);
    await m.end();
    unitId = await seedUnit(orgId, await seedProperty(orgId), { rateKobo: 10_000_000 });
    fd = (await signInAs(t, 'frontdesk', orgId)).agent;
  });
  const guest = async (email: string | null) => {
    const id = await seedGuest(orgId, { fullName: 'Adaeze Okafor' });
    if (email) { const m = await migratorClient(); await m.query(`update guest set email=$1 where id=$2`, [email, id]); await m.end(); }
    return id;
  };
  const book = async (guestId: string, status = 'tentative') => (await fd.post('/v1/bookings').send({ unitId, guestId, checkIn: '2026-11-01', checkOut: '2026-11-03', guestCount: 2, source: 'whatsapp', status }).expect(201)).body.id as string;

  it('confirmation is sent once per booking; receipt per payment', async () => {
    const b = await book(await guest('ada@example.ng'));
    await fd.post(`/v1/bookings/${b}/payments`).send({ kind: 'payment', amountKobo: 5_000_000, method: 'cash', receivedOn: '2026-10-10' }).expect(201); // auto-confirms
    await fd.post(`/v1/bookings/${b}/payments`).send({ kind: 'payment', amountKobo: 5_000_000, method: 'cash', receivedOn: '2026-10-11' }).expect(201);
    const rows = await outbox(orgId);
    expect(rows.filter((r) => r.template_key === 'booking_confirmation')).toHaveLength(1);
    expect(rows.filter((r) => r.template_key === 'payment_receipt')).toHaveLength(2);
  });

  it('no email, no auto send', async () => {
    const b = await book(await guest(null), 'confirmed');
    await fd.post(`/v1/bookings/${b}/payments`).send({ kind: 'payment', amountKobo: 5_000_000, method: 'cash', receivedOn: '2026-10-10' }).expect(201);
    expect(await outbox(orgId)).toEqual([]);
    await fd.post(`/v1/bookings/${b}/messages/email`).send({ templateKey: 'booking_confirmation' }).expect(400);
  });

  it('auto email can be switched off per template', async () => {
    const admin = (await signInAs(t, 'admin', orgId)).agent;
    const tpl = (await admin.get('/v1/templates').expect(200)).body.items[0];
    await admin.put('/v1/templates/booking_confirmation').send({ emailSubject: tpl.emailSubject, emailBody: tpl.emailBody, whatsappBody: tpl.whatsappBody, autoEmail: false, active: true }).expect(200);
    await book(await guest('ada@example.ng'), 'confirmed');
    expect(await outbox(orgId)).toEqual([]);
  });

  it('pre-arrival job queues check-in details at 10:00 local the day before', async () => {
    await book(await guest('ada@example.ng'), 'confirmed');
    const job = t.app.get(PreArrivalJob);
    await job.run(new Date('2026-10-31T08:00:00Z')); // 09:00 Lagos — too early
    expect((await outbox(orgId)).filter((r) => r.template_key === 'check_in_details')).toHaveLength(0);
    await job.run(new Date('2026-10-31T09:00:00Z')); // 10:00 Lagos
    await job.run(new Date('2026-10-31T09:30:00Z'));
    expect((await outbox(orgId)).filter((r) => r.template_key === 'check_in_details')).toHaveLength(1);
  });

  it('preview renders live data and a wa.me link; whatsapp open is logged', async () => {
    const b = await book(await guest('ada@example.ng'), 'confirmed');
    const p = (await fd.get(`/v1/bookings/${b}/messages?templateKey=booking_confirmation`).expect(200)).body;
    expect(p.whatsapp.url).toMatch(/^https:\/\/wa\.me\/2348030000000\?text=Hi%20Adaeze/);
    expect(p.email.to).toBe('ada@example.ng');
    await fd.post(`/v1/bookings/${b}/messages/whatsapp-opened`).send({ templateKey: 'booking_confirmation' }).expect(200);
    const log = (await fd.get(`/v1/bookings/${b}/messages/log`).expect(200)).body.items;
    expect(log.map((l: { channel: string; status: string }) => `${l.channel}:${l.status}`)).toEqual(expect.arrayContaining(['whatsapp:whatsapp_opened', 'email:queued']));
  });
});
```
(`PreArrivalJob` is registered in both `MessagingModule` (so tests can get it from the API app) and run by cron only in the worker: put the `@Cron` on a thin `PreArrivalCron` in the worker that calls `PreArrivalJob.run()`; same pattern recommended for every job from here on.)

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement**

`triggers.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { render, type TemplateKey } from '@boogbe/shared';
import type { OrgTx } from '../../common/db/org-db.service';
import { BookingHooks } from '../bookings/booking-hooks';
import { PaymentHooks } from '../payments/payment-hooks';
import { OutboxService } from './outbox.service';
import { TemplatesService } from './templates.service';
import { VarsService } from './vars.service';

@Injectable()
export class TriggersService implements OnModuleInit {
  constructor(private readonly bookingHooks: BookingHooks, private readonly paymentHooks: PaymentHooks, private readonly templates: TemplatesService, private readonly vars: VarsService, private readonly outbox: OutboxService) {}

  onModuleInit() {
    this.bookingHooks.register({
      afterCreate: async (tx, ctx, b) => { if (b.status === 'confirmed') await this.auto(tx, ctx.orgId, b.id, 'booking_confirmation', `auto-booking_confirmation-${b.id}`); },
      afterTransition: async (tx, ctx, b) => {
        const orgId = ctx?.orgId ?? await this.currentOrg(tx);
        if (b.status === 'confirmed') await this.auto(tx, orgId, b.id, 'booking_confirmation', `auto-booking_confirmation-${b.id}`);
        if (b.status === 'checked_out') await this.auto(tx, orgId, b.id, 'post_checkout_thanks', `auto-post_checkout_thanks-${b.id}`);
      },
    });
    this.paymentHooks.register({
      afterRecord: async (tx, ctx, bookingId, e) => {
        if (e.kind === 'payment' || e.kind === 'deposit_received') await this.auto(tx, ctx.orgId, bookingId, 'payment_receipt', `auto-payment_receipt-${e.id}`, { paymentId: e.id, lastPaymentKobo: e.amountKobo });
        if (e.kind === 'deposit_returned') await this.auto(tx, ctx.orgId, bookingId, 'deposit_returned', `auto-deposit_returned-${e.id}`);
      },
    });
  }

  private async currentOrg(tx: OrgTx) { return (await tx.$queryRaw<{ o: string }[]>`SELECT app_current_org() AS o`)[0]!.o; }

  async auto(tx: OrgTx, orgId: string, bookingId: string, key: TemplateKey, dedupeKey: string, opts: { paymentId?: string; lastPaymentKobo?: number } = {}) {
    const tpl = await this.templates.getIn(tx, key);
    if (!tpl.active || !tpl.autoEmail) return;
    const booking = await tx.booking.findFirstOrThrow({ where: { id: bookingId }, include: { guest: true } });
    if (!booking.guest.email) return;
    const vars = await this.vars.forBooking(tx, orgId, bookingId, { lastPaymentKobo: opts.lastPaymentKobo });
    await this.outbox.queueEmail(tx, { bookingId, paymentId: opts.paymentId, templateKey: key, to: booking.guest.email, subject: render(tpl.emailSubject, vars), bodyMarkdown: render(tpl.emailBody, vars), dedupeKey });
  }
}
```
`pre-arrival.job.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { addDays, todayIn } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { JobRunner } from '../../common/jobs/job-runner';
import { TriggersService } from './triggers.service';

const localHour = (tz: string, now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));

@Injectable()
export class PreArrivalJob {
  constructor(private readonly runner: JobRunner, private readonly orgDb: OrgDb, private readonly triggers: TriggersService) {}
  async run(now = new Date()) {
    return this.runner.forEachActiveOrg('messaging.preArrival', async (org) => {
      if (localHour(org.timezone, now) !== 10) return;
      const tomorrow = addDays(todayIn(org.timezone, now), 1);
      await this.orgDb.run(org.id, async (tx) => {
        const due = await tx.booking.findMany({ where: { status: 'confirmed', checkIn: new Date(`${tomorrow}T00:00:00Z`) }, select: { id: true } });
        for (const b of due) await this.triggers.auto(tx, org.id, b.id, 'check_in_details', `auto-check_in_details-${b.id}`);
      });
    });
  }
}
```
Worker cron wrapper `apps/api/src/modules/messaging/messaging.crons.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PreArrivalJob } from './pre-arrival.job';
@Injectable()
export class MessagingCrons {
  constructor(private readonly preArrival: PreArrivalJob) {}
  @Cron('5 * * * *') async preArrivalTick() { await this.preArrival.run(); }
}
```
(Move `MessageDispatchJob`'s `@Cron` into `MessagingCrons` too, and `BookingHoldsJob`/`IcalImportJob` likewise get thin cron wrappers in the worker only — refactor them in this task so that **no `@Cron` lives in a provider the API process instantiates**. Add a static test `apps/api/src/no-cron-in-api.spec.ts` that compiles `AppModule` and asserts `SchedulerRegistry` has no cron jobs.)

`booking-messages.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { markdownToHtml, render, waLink, type BookingMessagePreview, type MessageLogEntry, type TemplateKey } from '@boogbe/shared';
import { OrgDb } from '../../common/db/org-db.service';
import { MemberNames } from '../../common/db/member-names';
import { AppError, notFound } from '../../common/http/app-error';
import type { OrgCtx } from '../../common/auth/request-ctx';
import { OutboxService } from './outbox.service';
import { TemplatesService } from './templates.service';
import { VarsService } from './vars.service';

@Injectable()
export class BookingMessagesService {
  constructor(private readonly orgDb: OrgDb, private readonly templates: TemplatesService, private readonly vars: VarsService, private readonly outbox: OutboxService, private readonly names: MemberNames) {}

  preview(ctx: OrgCtx, bookingId: string, key: TemplateKey): Promise<BookingMessagePreview> {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const b = await tx.booking.findFirst({ where: { id: bookingId }, include: { guest: true } });
      if (!b) throw notFound('Booking');
      const tpl = await this.templates.getIn(tx, key); const vars = await this.vars.forBooking(tx, ctx.orgId, bookingId);
      const text = render(tpl.whatsappBody, vars); const body = render(tpl.emailBody, vars);
      return { templateKey: key, email: { to: b.guest.email, subject: render(tpl.emailSubject, vars), html: markdownToHtml(body), text: body }, whatsapp: { to: b.guest.phoneE164, text, url: waLink(b.guest.phoneE164, text) } };
    });
  }

  sendEmail(ctx: OrgCtx, bookingId: string, input: { templateKey: TemplateKey; subject?: string; body?: string }) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const b = await tx.booking.findFirst({ where: { id: bookingId }, include: { guest: true } });
      if (!b) throw notFound('Booking');
      if (!b.guest.email) throw new AppError('VALIDATION_FAILED', 400, 'Add an email address for this guest first');
      const tpl = await this.templates.getIn(tx, input.templateKey); const vars = await this.vars.forBooking(tx, ctx.orgId, bookingId);
      const r = await this.outbox.queueEmail(tx, { bookingId, templateKey: input.templateKey, to: b.guest.email, subject: render(input.subject ?? tpl.emailSubject, vars), bodyMarkdown: render(input.body ?? tpl.emailBody, vars), actorMemberId: ctx.memberId });
      return (await this.logIn(tx, ctx.orgId, bookingId)).find((x) => x.id === r!.id)!;
    });
  }

  whatsappOpened(ctx: OrgCtx, bookingId: string, key: TemplateKey) {
    return this.orgDb.run(ctx.orgId, async (tx) => {
      const b = await tx.booking.findFirst({ where: { id: bookingId }, include: { guest: true } });
      if (!b) throw notFound('Booking');
      const tpl = await this.templates.getIn(tx, key); const vars = await this.vars.forBooking(tx, ctx.orgId, bookingId);
      await this.outbox.logWhatsapp(tx, { bookingId, templateKey: key, to: b.guest.phoneE164, text: render(tpl.whatsappBody, vars), actorMemberId: ctx.memberId });
      return { ok: true };
    });
  }

  private async logIn(tx: Parameters<Parameters<OrgDb['run']>[1]>[0], orgId: string, bookingId: string): Promise<MessageLogEntry[]> {
    const rows = await tx.outboundMessage.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
    const names = await this.names.forMembers(orgId, rows.map((r) => r.actorMemberId).filter((x): x is string => !!x));
    return rows.map((r) => ({ id: r.id, templateKey: r.templateKey, channel: r.channel as 'email' | 'whatsapp', recipient: r.recipient, subject: r.subject, status: r.status as MessageLogEntry['status'], attempts: r.attempts, error: r.error, actorName: r.actorMemberId ? names.get(r.actorMemberId) ?? null : 'Automatic', createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null }));
  }

  log(ctx: OrgCtx, bookingId: string) { return this.orgDb.run(ctx.orgId, async (tx) => ({ items: await this.logIn(tx, ctx.orgId, bookingId) })); }
}
```
(Replace the awkward `logIn` `tx` type with `OrgTx` imported from `org-db.service`.)

`booking-messages.controller.ts` — `@Controller('bookings/:id/messages')`: `@Get()` preview with `@Query('templateKey')` validated by `TemplateKeyEnum` (`messages.read`); `@Get('log')` (`messages.read`); `@Post('email')` (`messages.send`, `SendEmailInput`); `@Post('whatsapp-opened')` `@HttpCode(200)` (`messages.send`). Register `TriggersService`, `PreArrivalJob`, `BookingMessagesService`, controllers in `MessagingModule`; `MessagingCrons` in `WorkerModule`.

- [ ] **Step 4:** PASS. **Step 5: Commit** `git commit -m "feat(messaging): automatic emails, pre-arrival job, manual send, WhatsApp log and message log [MSG-03..07]"`

---

### Task 6 (T-M5-06) [ui]: Template editor

**Files:** Create `apps/app/src/features/messaging/{TemplatesPage.tsx,TemplateEditor.tsx,PlaceholderPicker.tsx}`; router `/settings/messages` (nav "Messages" `messages.read`, icon `MessageSquare`); Test `apps/app/src/features/messaging/TemplateEditor.test.tsx`.

**Interfaces:** `TemplateEditor({ template, canWrite, onSaved })`: subject input, email body textarea, WhatsApp textarea (character count; warn > 1000), "Send automatically by email" toggle, "Active" toggle; `PlaceholderPicker` inserts `{{placeholder}}` at the cursor of the last-focused field; live preview (debounced `POST /v1/templates/preview`) showing rendered email HTML (in a sandboxed `<iframe srcDoc sandbox="">`) and WhatsApp bubble; client-side `unknownPlaceholders` errors inline.

- [ ] **Step 1: Failing test**
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateEditor } from './TemplateEditor';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async () => ({ emailSubject: 'S', emailHtml: '<p>x</p>', whatsappText: 'w' })) }));
const tpl = { key: 'booking_confirmation', label: 'Booking confirmation', emailSubject: 'Hi', emailBody: 'Hello {{guest.firstName}}', whatsappBody: 'Hi', autoEmail: true, active: true, updatedAt: '' } as const;

describe('TemplateEditor', () => {
  it('flags unknown placeholders and inserts known ones', async () => {
    render(<TemplateEditor template={tpl} canWrite onSaved={vi.fn()} />);
    const body = screen.getByLabelText('Email message');
    await userEvent.type(body, ' {{{{guest.nick}}');
    expect(await screen.findByText(/Unknown placeholder: \{\{guest.nick\}\}/)).toBeInTheDocument();
    await userEvent.clear(body);
    await userEvent.click(body);
    await userEvent.click(screen.getByRole('button', { name: 'Insert unit name' }));
    expect(body).toHaveValue('{{unit.name}}');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
```
(`userEvent.type` treats `{` as a key descriptor; `{{` types a literal `{`.)

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `PlaceholderPicker.tsx`:
```tsx
import { PLACEHOLDERS, type Placeholder } from '@boogbe/shared';
const LABELS: Record<Placeholder, string> = {
  'guest.firstName': 'guest first name', 'guest.fullName': 'guest full name', 'booking.ref': 'booking ref', 'booking.checkIn': 'check-in date', 'booking.checkOut': 'check-out date',
  'booking.nights': 'nights', 'booking.guests': 'guests', 'unit.name': 'unit name', 'property.name': 'property name', 'property.address': 'address',
  'money.total': 'total', 'money.paid': 'paid', 'money.balance': 'balance', 'money.deposit': 'caution deposit', 'money.lastPayment': 'last payment',
  'operator.name': 'business name', 'operator.phone': 'business phone', 'operator.email': 'business email', 'checkIn.time': 'check-in time', 'checkOut.time': 'check-out time',
  'unit.checkInInstructions': 'check-in instructions',
};
export function PlaceholderPicker({ onInsert }: { onInsert: (p: Placeholder) => void }) {
  return (
    <div className="flex flex-wrap gap-1" aria-label="Insert placeholder">
      {PLACEHOLDERS.map((p) => <button key={p} type="button" aria-label={`Insert ${LABELS[p]}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(p)} className="rounded-full border border-line px-2 py-0.5 text-xs hover:bg-surface-2">{LABELS[p]}</button>)}
    </div>
  );
}
```
`TemplateEditor.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { PreviewResponse, unknownPlaceholders, type MessageTemplate, type Placeholder } from '@boogbe/shared';
import { Button, Field, Input } from '@boogbe/ui';
import { api, ApiError } from '../../lib/api';
import { PlaceholderPicker } from './PlaceholderPicker';

type F = 'emailSubject' | 'emailBody' | 'whatsappBody';
export function TemplateEditor({ template, canWrite, onSaved }: { template: MessageTemplate; canWrite: boolean; onSaved: () => void }) {
  const [v, setV] = useState({ emailSubject: template.emailSubject, emailBody: template.emailBody, whatsappBody: template.whatsappBody, autoEmail: template.autoEmail, active: template.active });
  const [preview, setPreview] = useState<{ emailSubject: string; emailHtml: string; whatsappText: string } | null>(null);
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const last = useRef<{ field: F; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const unknown = (f: F) => { const u = unknownPlaceholders(v[f]); return u.length ? `Unknown placeholder: ${u.map((x) => `{{${x}}}`).join(', ')}` : undefined; };
  const invalid = (['emailSubject', 'emailBody', 'whatsappBody'] as F[]).some((f) => unknown(f));
  useEffect(() => {
    if (invalid) return;
    const t = setTimeout(() => { api('/v1/templates/preview', { method: 'POST', body: { emailSubject: v.emailSubject, emailBody: v.emailBody, whatsappBody: v.whatsappBody }, schema: PreviewResponse }).then(setPreview).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [v.emailSubject, v.emailBody, v.whatsappBody, invalid]);
  const insert = (p: Placeholder) => {
    const target = last.current; if (!target) return;
    const { field, el } = target; const token = `{{${p}}}`;
    const start = el.selectionStart ?? v[field].length; const end = el.selectionEnd ?? start;
    const next = v[field].slice(0, start) + token + v[field].slice(end);
    setV({ ...v, [field]: next });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };
  const track = (field: F) => ({ onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { last.current = { field, el: e.currentTarget }; }, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [field]: e.target.value }), value: v[field], readOnly: !canWrite });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault(); setErr(undefined); setBusy(true);
        try { await api(`/v1/templates/${template.key}`, { method: 'PUT', body: v }); onSaved(); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } finally { setBusy(false); }
      }}>
        <Field label="Email subject" error={unknown('emailSubject')}><Input {...track('emailSubject')} /></Field>
        <Field label="Email message" error={unknown('emailBody')} hint="**bold**, [link text](https://…)"><textarea className="min-h-48 rounded-lg border border-line bg-surface p-3 font-mono text-sm" {...track('emailBody')} /></Field>
        <Field label="WhatsApp message" error={unknown('whatsappBody')} hint={`${v.whatsappBody.length} characters${v.whatsappBody.length > 1000 ? ' — long messages are hard to read on phones' : ''}`}><textarea className="min-h-32 rounded-lg border border-line bg-surface p-3 text-sm" {...track('whatsappBody')} /></Field>
        {canWrite && <PlaceholderPicker onInsert={insert} />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canWrite} checked={v.autoEmail} onChange={(e) => setV({ ...v, autoEmail: e.target.checked })} />Send automatically by email</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canWrite} checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Active</label>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        {canWrite && <Button type="submit" loading={busy} disabled={invalid}>Save</Button>}
      </form>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Email preview</p>
        <div className="rounded-lg border border-line"><p className="border-b border-line p-2 text-sm font-medium">{preview?.emailSubject}</p><iframe title="Email preview" sandbox="" className="h-64 w-full bg-white" srcDoc={`<div style="font-family:system-ui;padding:12px;color:#182d32">${preview?.emailHtml ?? ''}</div>`} /></div>
        <p className="text-sm font-medium">WhatsApp preview</p>
        <div className="max-w-sm whitespace-pre-wrap rounded-2xl rounded-tl-none bg-[#dcf8c6] p-3 text-sm text-[#111]">{preview?.whatsappText}</div>
      </div>
    </div>
  );
}
```
`TemplatesPage.tsx`: lists templates (from `GET /v1/templates`) as tabs; selected one renders `TemplateEditor` (`canWrite = can(role,'templates.write')`); `key={template.key}` to reset editor state on tab change.

- [ ] **Step 4:** PASS + build. **Step 5: Commit** `git commit -m "feat(app): message template editor with placeholders and live previews [MSG-01 MSG-02]"`

---

### Task 7 (T-M5-07) [ui][e2e]: Booking messages panel and E2E-07

**Files:** Create `apps/app/src/features/messaging/{MessagesPanel.tsx,register.ts}`; `main.tsx` imports `register`; Create `e2e/e07-whatsapp.spec.ts`; Test `apps/app/src/features/messaging/MessagesPanel.test.tsx`.

**Interfaces:** `<MessagesPanel booking refresh />` pushed into `BOOKING_PANELS`: template select (`TEMPLATE_LABELS`), buttons "WhatsApp" (anchor `href={preview.whatsapp.url}` `target="_blank"` that also `POST`s `whatsapp-opened` on click) and "Email" (disabled with title "No email address for this guest" when `email.to` is null; confirm dialog showing subject + rendered HTML preview before queueing); message log list (channel icon, template label, status badge — queued/sent/failed with error/opened, actor, time).

- [ ] **Step 1: Failing test** `MessagesPanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { MessagesPanel } from './MessagesPanel';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: vi.fn(async (path: string) => path.endsWith('/log')
  ? { items: [{ id: 'm1', templateKey: 'payment_receipt', channel: 'email', recipient: 'ada@x.ng', subject: 'Payment received', status: 'failed', attempts: 3, error: 'simulated outage', actorName: 'Automatic', createdAt: '2026-10-10T10:00:00Z', sentAt: null }] }
  : path.includes('/messages?') ? { templateKey: 'booking_confirmation', email: { to: null, subject: 'S', html: '<p>x</p>', text: 'x' }, whatsapp: { to: '+2348030000000', text: 'Hi Adaeze', url: 'https://wa.me/2348030000000?text=Hi%20Adaeze' } } : { ok: true }) }));
vi.mock('../../lib/use-me', () => ({ useMe: () => ({ me: { activeOrg: { role: 'frontdesk', timezone: 'Africa/Lagos' } } }) }));

describe('MessagesPanel', () => {
  it('links WhatsApp, logs the open, disables email without address, shows failures', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><MessagesPanel booking={{ id: 'b1' } as never} refresh={vi.fn()} /></SWRConfig>);
    const wa = await screen.findByRole('link', { name: /WhatsApp/ });
    expect(wa).toHaveAttribute('href', 'https://wa.me/2348030000000?text=Hi%20Adaeze');
    await userEvent.click(wa);
    expect(api).toHaveBeenCalledWith('/v1/bookings/b1/messages/whatsapp-opened', expect.objectContaining({ method: 'POST', body: { templateKey: 'booking_confirmation' } }));
    expect(screen.getByRole('button', { name: /Email/ })).toBeDisabled();
    expect(screen.getByText(/Failed: simulated outage/)).toBeInTheDocument();
  });
});
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** `MessagesPanel.tsx`:
```tsx
import { Mail, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { BookingMessagePreview, can, MessageLogEntry, TEMPLATE_KEYS, TEMPLATE_LABELS, type Booking, type TemplateKey } from '@boogbe/shared';
import { Badge, Button, Card, Dialog, Select, Spinner } from '@boogbe/ui';
import { api, useApi } from '../../lib/api';
import { useMe } from '../../lib/use-me';

const STATUS = { queued: <Badge tone="info">Sending</Badge>, sent: <Badge tone="success">Sent</Badge>, whatsapp_opened: <Badge>WhatsApp opened</Badge> } as const;

export function MessagesPanel({ booking }: { booking: Pick<Booking, 'id'>; refresh: () => void }) {
  const { me } = useMe(); const canSend = !!me?.activeOrg && can(me.activeOrg.role, 'messages.send');
  const [key, setKey] = useState<TemplateKey>('booking_confirmation'); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const { data: p } = useApi(`/v1/bookings/${booking.id}/messages?templateKey=${key}`, BookingMessagePreview);
  const { data: log, mutate } = useApi(`/v1/bookings/${booking.id}/messages/log`, z.object({ items: z.array(MessageLogEntry) }));
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold">Messages</h2>
      <div className="flex flex-wrap items-end gap-2">
        <Select aria-label="Message" value={key} onChange={(e) => setKey(e.target.value as TemplateKey)} className="w-56">{TEMPLATE_KEYS.map((k) => <option key={k} value={k}>{TEMPLATE_LABELS[k]}</option>)}</Select>
        {!p ? <Spinner /> : canSend && <>
          <a href={p.whatsapp.url} target="_blank" rel="noreferrer" onClick={() => { void api(`/v1/bookings/${booking.id}/messages/whatsapp-opened`, { method: 'POST', body: { templateKey: key } }).then(() => mutate()); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-medium text-white"><MessageCircle size={18} aria-hidden />WhatsApp</a>
          <Button variant="secondary" disabled={!p.email.to} title={p.email.to ? undefined : 'No email address for this guest'} onClick={() => setConfirm(true)}><Mail size={18} aria-hidden />Email</Button>
        </>}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {log?.items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2">
            {m.channel === 'email' ? <Mail size={14} aria-label="Email" /> : <MessageCircle size={14} aria-label="WhatsApp" />}
            <span>{m.templateKey ? TEMPLATE_LABELS[m.templateKey as TemplateKey] : m.subject}</span>
            {m.status === 'failed' ? <Badge tone="danger">Failed: {m.error}</Badge> : STATUS[m.status]}
            <span className="text-ink-muted">{m.actorName} · {new Date(m.createdAt).toLocaleString('en-NG')}</span>
          </li>
        ))}
      </ul>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={`Email ${p?.email.to ?? ''}`}>
        {p && <div className="flex flex-col gap-3">
          <p className="font-medium">{p.email.subject}</p>
          <iframe title="Email preview" sandbox="" className="h-64 w-full rounded border border-line bg-white" srcDoc={`<div style="font-family:system-ui;padding:12px">${p.email.html}</div>`} />
          <Button loading={busy} onClick={async () => { setBusy(true); await api(`/v1/bookings/${booking.id}/messages/email`, { method: 'POST', body: { templateKey: key } }); setBusy(false); setConfirm(false); await mutate(); }}>Send email</Button>
        </div>}
      </Dialog>
    </Card>
  );
}
```
`register.ts`: `BOOKING_PANELS.push(MessagesPanel);` — import in `main.tsx` after payments.

`e2e/e07-whatsapp.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { resetDb } from './fixtures';
import { createUnit, onboardOperator } from './helpers';

test.beforeAll(() => resetDb());

test('E2E-07 WhatsApp button opens wa.me with the rendered text', async ({ page, browser, context }) => {
  const admin = await onboardOperator(page, browser, 'tanu-wa');
  await createUnit(admin, { property: 'The Rock', unit: 'Kairo', rateNaira: '200000' });
  const unitId = (await (await admin.request.get('/v1/units')).json()).items[0].id;
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await admin.goto(`/bookings/new?unitId=${unitId}&checkIn=${d(2)}&checkOut=${d(5)}`);
  await admin.getByRole('button', { name: 'New guest' }).click();
  await admin.getByLabel('Full name').fill('Adaeze Okafor');
  await admin.getByLabel(/^Phone/).fill('08031234567');
  await admin.getByRole('button', { name: 'Add guest' }).click();
  await admin.getByRole('radio', { name: 'Confirmed' }).check();
  await admin.getByRole('button', { name: 'Save booking' }).click();
  const link = admin.getByRole('link', { name: 'WhatsApp' });
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/2348031234567\?text=/);
  const text = decodeURIComponent(href!.split('text=')[1]!);
  expect(text).toContain('Hi Adaeze, your stay at Kairo');
  expect(text).toContain('₦600,000');
  await admin.route('https://wa.me/**', (r) => r.fulfill({ status: 200, body: 'ok' }));
  const [popup] = await Promise.all([admin.waitForEvent('popup'), link.click()]);
  await popup.close();
  await expect(admin.getByText('WhatsApp opened')).toBeVisible();
  void context;
});
```
- [ ] **Step 4:** unit + e2e → PASS. **Step 5: Commit** `git commit -m "feat(app): booking messages panel with WhatsApp and email; E2E-07 [MSG-03..05]"`

---

## Self-review notes (completed)
- Coverage: MSG-01 (T1 defaults, T3 ensure/edit, T6 UI), MSG-02 (T1, T3 validation + preview), MSG-03 (T5 triggers + pre-arrival, T4 retries), MSG-04 (T1 `waLink`, T5 log, T7 UI), MSG-05 (T5 log, T7), MSG-06 (T4 from/reply-to), MSG-07 (M1 field, used in T3 vars; never exposed to owners — owner portal M7 excludes it).
- Structural change: from this milestone, `@Cron` decorators live only in worker-only `*Crons` classes; `no-cron-in-api.spec.ts` enforces it. Earlier jobs (`BookingHoldsJob`, `IcalImportJob`, `MessageDispatchJob`) are refactored in T-M5-05.
- Names: `OutboxService.queueEmail/logWhatsapp`, `TriggersService.auto`, `TemplatesService.ensureDefaults/getIn`, `VarsService.forBooking`, `PaymentsService.receiptForOrg`, `MemoryMailer.failNext`, `claim_outbound()`.
