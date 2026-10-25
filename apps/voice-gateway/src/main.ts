import { BookingService, ConsoleEmailSender, Db, StripeClient, VaultSecretStore, calendarResolver, OpenAICompatibleChatModel, ResendEmailSender, ToolExecutor, TwilioSmsSender, createHandlers, runJobsOnce, schedulePeriodicJobs } from '@vp/server';
import { hostname } from 'node:os';
import { loadConfig } from './config';
import { createGateway } from './server';
import { DeepgramStt } from './stt/deepgram';
import { AzureTts, LanguageRoutedTts } from './tts/azure';
import { UnavailableTts } from './tts/types';
import { DeepgramAuraTts } from './tts/deepgram-aura';
import { TwilioCallControl } from './twilio/call-control';

const cfg = loadConfig();
const db = Db.fromUrl(cfg.DATABASE_URL, 10);
const google = cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET ? { clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET } : null;
const resolveCalendar = calendarResolver(db, new VaultSecretStore(db), google);
const booking = new BookingService({ db, resolveCalendar });
const english = new DeepgramAuraTts({ apiKey: cfg.DEEPGRAM_API_KEY, host: cfg.DEEPGRAM_BASE, defaultVoice: cfg.DEEPGRAM_TTS_VOICE_EN });
const croatian = cfg.AZURE_SPEECH_KEY
  ? new AzureTts({ key: cfg.AZURE_SPEECH_KEY, region: cfg.AZURE_SPEECH_REGION, voices: { hr: cfg.AZURE_TTS_VOICE_HR } })
  : new UnavailableTts('No Croatian voice configured (AZURE_SPEECH_KEY)'); // fails safe: caller is transferred to the business

const { server, activeCalls } = createGateway({
  db,
  publicBaseUrl: cfg.PUBLIC_BASE_URL,
  twilioAuthToken: cfg.TWILIO_AUTH_TOKEN,
  streamSecret: cfg.STREAM_TOKEN_SECRET,
  stt: new DeepgramStt({ apiKey: cfg.DEEPGRAM_API_KEY, host: cfg.DEEPGRAM_BASE, model: cfg.DEEPGRAM_STT_MODEL }),
  tts: new LanguageRoutedTts({ en: english, hr: croatian }),
  model: new OpenAICompatibleChatModel({ baseUrl: cfg.LLM_BASE_URL, apiKey: cfg.LLM_API_KEY, model: cfg.LLM_MODEL, authHeader: cfg.LLM_AUTH_HEADER }),
  tools: new ToolExecutor({ db, booking }),
  callControl: new TwilioCallControl({ accountSid: cfg.TWILIO_ACCOUNT_SID, authToken: cfg.TWILIO_AUTH_TOKEN, region: cfg.TWILIO_REGION }),
});
server.listen(cfg.PORT, () => console.log(JSON.stringify({ event: 'gateway.listening', port: cfg.PORT })));

// Background worker in the same process (one small container). Scale out by running more instances.
let stopping = false;
if (cfg.RUN_WORKER === 'true') {
  const handlers = createHandlers({
    db,
    email: cfg.RESEND_API_KEY ? new ResendEmailSender({ apiKey: cfg.RESEND_API_KEY, from: cfg.EMAIL_FROM }) : new ConsoleEmailSender(),
    sms: cfg.TWILIO_SMS_FROM ? new TwilioSmsSender({ accountSid: cfg.TWILIO_ACCOUNT_SID, authToken: cfg.TWILIO_AUTH_TOKEN, from: cfg.TWILIO_SMS_FROM, region: cfg.TWILIO_REGION }) : null,
    siteUrl: cfg.SITE_URL,
    resolveCalendar,
    billing: cfg.STRIPE_SECRET_KEY
      ? { stripe: new StripeClient({ secretKey: cfg.STRIPE_SECRET_KEY }), siteUrl: cfg.SITE_URL, meterEventName: cfg.STRIPE_METER_EVENT_NAME, automaticTax: false }
      : null,
  });
  const workerId = `${hostname()}-${process.pid}`;
  const loop = async () => {
    while (!stopping) {
      try {
        await schedulePeriodicJobs(db);
        const r = await runJobsOnce(db, handlers, workerId);
        if (r.claimed === 0) await new Promise((res) => setTimeout(res, 2000));
      } catch (e) {
        console.error(JSON.stringify({ event: 'worker.error', message: (e as Error).message }));
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
  };
  void loop();
}

// Graceful shutdown: stop taking new calls, let active calls finish (up to 10 minutes) on deploys.
process.on('SIGTERM', () => {
  stopping = true;
  server.close();
  const deadline = Date.now() + 10 * 60_000;
  const wait = setInterval(() => {
    if (activeCalls.size === 0 || Date.now() > deadline) {
      clearInterval(wait);
      void db.end().finally(() => process.exit(0));
    }
  }, 1000);
});
