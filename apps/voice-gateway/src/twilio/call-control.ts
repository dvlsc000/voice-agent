/** Live call control through Twilio's REST API (regional host so call data stays in the selected region). */
export interface CallControl {
  updateTwiml(callSid: string, twiml: string): Promise<void>;
  hangup(callSid: string): Promise<void>;
}

export class TwilioCallControl implements CallControl {
  constructor(private readonly opts: { accountSid: string; authToken: string; region: 'ie1' | 'us1'; fetch?: typeof fetch }) {}

  private async post(callSid: string, form: Record<string, string>): Promise<void> {
    const host = this.opts.region === 'ie1' ? 'api.dublin.ie1.twilio.com' : 'api.twilio.com';
    const res = await (this.opts.fetch ?? fetch)(`https://${host}/2010-04-01/Accounts/${this.opts.accountSid}/Calls/${callSid}.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form),
    });
    if (!res.ok) throw new Error(`Twilio call update failed: ${res.status}`);
  }

  updateTwiml(callSid: string, twiml: string): Promise<void> {
    return this.post(callSid, { Twiml: twiml });
  }
  hangup(callSid: string): Promise<void> {
    return this.post(callSid, { Status: 'completed' });
  }
}
