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
