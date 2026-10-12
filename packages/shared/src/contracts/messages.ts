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
export type PreviewTemplateInput = z.infer<typeof PreviewTemplateInput>;
export const PreviewResponse = z.object({ emailSubject: z.string(), emailHtml: z.string(), whatsappText: z.string() });
export type PreviewResponse = z.infer<typeof PreviewResponse>;
export const BookingMessagePreview = z.object({
  templateKey: TemplateKeyEnum,
  email: z.object({ to: z.string().nullable(), subject: z.string(), html: z.string(), text: z.string() }),
  whatsapp: z.object({ to: z.string(), text: z.string(), url: z.string() }),
});
export type BookingMessagePreview = z.infer<typeof BookingMessagePreview>;
export const SendEmailInput = z.object({ templateKey: TemplateKeyEnum, subject: z.string().trim().min(1).max(150).optional(), body: z.string().trim().min(1).max(5000).optional() });
export type SendEmailInput = z.infer<typeof SendEmailInput>;
export const WhatsappOpenedInput = z.object({ templateKey: TemplateKeyEnum });
export type WhatsappOpenedInput = z.infer<typeof WhatsappOpenedInput>;
export const MessageLogEntry = z.object({
  id: z.string(), templateKey: z.string().nullable(), channel: z.enum(['email', 'whatsapp']), recipient: z.string(), subject: z.string().nullable(),
  status: z.enum(['queued', 'sent', 'failed', 'whatsapp_opened']), attempts: z.number().int(), error: z.string().nullable(),
  actorName: z.string().nullable(), createdAt: z.string(), sentAt: z.string().nullable(),
});
export type MessageLogEntry = z.infer<typeof MessageLogEntry>;
