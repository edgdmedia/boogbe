import { ROLE_LABELS, type OrgRole } from '@boogbe/shared';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const layout = (body: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#182d32">${body}<p style="color:#6b7b80;font-size:12px">Boogbe by EDGD Media</p></div>`;

export function inviteEmail(p: { orgName: string; role: OrgRole; url: string }) {
  const subject = `You're invited to ${p.orgName} on Boogbe`;
  const text = `You've been invited to join ${p.orgName} on Boogbe as ${ROLE_LABELS[p.role]}.\n\nAccept the invitation: ${p.url}\n\nThis link expires in 7 days.`;
  const html = layout(
    `<p>You've been invited to join <strong>${esc(p.orgName)}</strong> on Boogbe as ${esc(ROLE_LABELS[p.role])}.</p><p><a href="${esc(p.url)}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`,
  );
  return { subject, text, html };
}

export function resetPasswordEmail(p: { url: string }) {
  const subject = 'Reset your Boogbe password';
  const text = `Use this link to set a new password: ${p.url}\n\nIt expires in 1 hour. If you didn't ask for this, ignore this email.`;
  const html = layout(
    `<p><a href="${esc(p.url)}">Set a new password</a></p><p>It expires in 1 hour. If you didn't ask for this, ignore this email.</p>`,
  );
  return { subject, text, html };
}
