export function renderNotice(template: string, payload: Record<string, unknown>): { subject: string; text: string } {
  const subjects: Record<string, string> = {
    'order.placed': 'Your PROMEC order is placed',
    'password.reset': 'Reset your PROMEC password',
    'email.verify': 'Verify your PROMEC email',
    'ticket.reply': 'PROMEC support replied',
    'part.quoted': 'PROMEC quoted your part request',
    'return.updated': 'Your PROMEC return was updated',
    'payment.received': 'PROMEC received your transfer',
  };
  const lines = Object.entries(payload)
    .filter(([, value]) => value != null && typeof value !== 'object')
    .map(([key, value]) => `${key}: ${String(value)}`);
  return {
    subject: subjects[template] ?? 'A message from PROMEC',
    text: [subjects[template] ?? template, ...lines].join('\n'),
  };
}

export async function sendResend(input: { apiKey: string; from: string; to: string; subject: string; text: string; idempotencyKey: string }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, text: input.text }),
  });
  if (!response.ok) throw new Error(`Resend rejected the email (${response.status})`);
  return (await response.json()) as { id?: string };
}

export async function sendTermii(input: { apiKey: string; sender: string; to: string; text: string; channel: 'sms' | 'whatsapp' }) {
  const response = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: input.apiKey,
      to: input.to,
      from: input.sender,
      sms: input.text,
      type: 'plain',
      channel: input.channel === 'whatsapp' ? 'whatsapp' : 'generic',
    }),
  });
  if (!response.ok) throw new Error(`Termii rejected the message (${response.status})`);
}
