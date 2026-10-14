import { z } from 'zod';
import { TEMPLATE_KEYS, unknownPlaceholders } from '../domain/templates';

export const TemplateKeyEnum = z.enum(TEMPLATE_KEYS);
const checkPlaceholders = (ctx: z.RefinementCtx, fields: Record<string, string | undefined>) => {
  for (const [f, text] of Object.entries(fields)) {
    const bad = unknownPlaceholders(text ?? '');
    if (bad.length) ctx.addIssue({ code: 'custom', path: [f], message: `Unknown placeholder: ${bad.map((b) => `{{${b}}}`).join(', ')}` });
  }
};
const noUnknown = (v: { emailSubject: string; emailBody: string; whatsappBody: string }, ctx: z.RefinementCtx) =>
  checkPlaceholders(ctx, { emailSubject: v.emailSubject, emailBody: v.emailBody, whatsappBody: v.whatsappBody });
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
export const PreviewTemplateInput = z.object({ emailSubject: z.string().max(150), emailBody: z.string().max(5000), whatsappBody: z.string().max(1500) }).superRefine(noUnknown);
export type PreviewTemplateInput = z.infer<typeof PreviewTemplateInput>;
export const PreviewResponse = z.object({ emailSubject: z.string(), emailHtml: z.string(), whatsappText: z.string() });
export type PreviewResponse = z.infer<typeof PreviewResponse>;
export const BookingMessagePreview = z.object({
  templateKey: TemplateKeyEnum,
  email: z.object({ to: z.string().nullable(), subject: z.string(), html: z.string(), text: z.string() }),
  whatsapp: z.object({ to: z.string(), text: z.string(), url: z.string() }),
});
export type BookingMessagePreview = z.infer<typeof BookingMessagePreview>;
export const SendEmailInput = z.object({ templateKey: TemplateKeyEnum, subject: z.string().trim().min(1).max(150).optional(), body: z.string().trim().min(1).max(5000).optional() })
  .superRefine((v, ctx) => checkPlaceholders(ctx, { subject: v.subject, body: v.body }));
export type SendEmailInput = z.infer<typeof SendEmailInput>;
export const WhatsappOpenedInput = z.object({ templateKey: TemplateKeyEnum });
export type WhatsappOpenedInput = z.infer<typeof WhatsappOpenedInput>;
/**
 * `skipped_no_mailer`: the email was never handed to a provider because no real mailer is configured (no
 * RESEND_API_KEY). It must never show as sent (owner, 2026-10-14).
 */
export const MessageStatus = z.enum(['queued', 'sent', 'failed', 'whatsapp_opened', 'skipped_no_mailer']);
export type MessageStatus = z.infer<typeof MessageStatus>;
export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  queued: 'Sending…',
  sent: 'Sent',
  failed: 'Failed',
  whatsapp_opened: 'Opened in WhatsApp',
  skipped_no_mailer: 'Not sent (email not set up)',
};
export const MessageLogEntry = z.object({
  id: z.string(), templateKey: z.string().nullable(), channel: z.enum(['email', 'whatsapp']), recipient: z.string(), subject: z.string().nullable(),
  status: MessageStatus, attempts: z.number().int(), error: z.string().nullable(),
  actorName: z.string().nullable(), createdAt: z.string(), sentAt: z.string().nullable(),
});
export type MessageLogEntry = z.infer<typeof MessageLogEntry>;
