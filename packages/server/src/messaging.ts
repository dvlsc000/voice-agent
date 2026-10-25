/**
 * Outbound messaging providers. The worker depends only on these interfaces.
 * Implementations: Console (development), Resend (email, HTTPS API), Twilio (SMS, REST API).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}
export interface SmsMessage {
  to: string; // E.164
  body: string;
}
export interface SendResult {
  providerMessageId: string;
}

export interface EmailSender {
  readonly id: string;
  send(m: EmailMessage): Promise<SendResult>;
}
export interface SmsSender {
  readonly id: string;
  send(m: SmsMessage): Promise<SendResult>;
}

/** Permanent failures should not be retried (bad address, unsubscribed number). */
export class PermanentSendError extends Error {
  override name = 'PermanentSendError';
}

export class ConsoleEmailSender implements EmailSender {
  readonly id = 'console';
  readonly sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<SendResult> {
    this.sent.push(m);
    return { providerMessageId: `console-${this.sent.length}` };
  }
}
export class ConsoleSmsSender implements SmsSender {
  readonly id = 'console';
  readonly sent: SmsMessage[] = [];
  async send(m: SmsMessage): Promise<SendResult> {
    this.sent.push(m);
    return { providerMessageId: `console-${this.sent.length}` };
  }
}

type FetchLike = typeof fetch;

export class ResendEmailSender implements EmailSender {
  readonly id = 'resend';
  constructor(private readonly opts: { apiKey: string; from: string; fetch?: FetchLike; baseUrl?: string }) {}
  async send(m: EmailMessage): Promise<SendResult> {
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl ?? 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.opts.from, to: [m.to], subject: m.subject, text: m.text, reply_to: m.replyTo }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.status === 422 || res.status === 400) throw new PermanentSendError(body.message ?? `Rejected (${res.status})`);
    if (!res.ok || !body.id) throw new Error(`Email provider error ${res.status}: ${body.message ?? 'unknown'}`);
    return { providerMessageId: body.id };
  }
}

export class TwilioSmsSender implements SmsSender {
  readonly id = 'twilio';
  constructor(
    private readonly opts: { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string; fetch?: FetchLike; region?: 'ie1' | 'us1' },
  ) {}
  async send(m: SmsMessage): Promise<SendResult> {
    const host = this.opts.region === 'ie1' ? 'api.dublin.ie1.twilio.com' : 'api.twilio.com';
    const form = new URLSearchParams({ To: m.to, Body: m.body });
    if (this.opts.messagingServiceSid) form.set('MessagingServiceSid', this.opts.messagingServiceSid);
    else if (this.opts.from) form.set('From', this.opts.from);
    const res = await (this.opts.fetch ?? fetch)(`https://${host}/2010-04-01/Accounts/${this.opts.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (res.status === 400) throw new PermanentSendError(body.message ?? 'Rejected');
    if (!res.ok || !body.sid) throw new Error(`SMS provider error ${res.status}: ${body.message ?? 'unknown'}`);
    return { providerMessageId: body.sid };
  }
}
