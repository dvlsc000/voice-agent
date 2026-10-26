import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BookingService, Db, OpenAICompatibleChatModel, VaultSecretStore, calendarResolver } from '@vp/server';
import { DeepgramStt } from '../stt/deepgram';
import { DeepgramAuraTts } from '../tts/deepgram-aura';
import { AzureTts, LanguageRoutedTts } from '../tts/azure';
import { UnavailableTts } from '../tts/types';
import { ensureDemoBusinesses } from './demo-businesses';
import { createPlayground } from './server';

// Settings come from .env.playground in the repository root (git-ignored), or from the environment.
const envFile = fileURLToPath(new URL('../../../../.env.playground', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const schema = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().default('mistral-small-latest'),
  LLM_AUTH_HEADER: z.enum(['bearer', 'api-key']).default('bearer'),
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_BASE: z.string().default('api.eu.deepgram.com'),
  DEEPGRAM_STT_MODEL: z.string().default('nova-3'),
  DEEPGRAM_TTS_VOICE_EN: z.string().default('aura-2-thalia-en'),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().default('westeurope'),
  AZURE_TTS_VOICE_HR: z.string().default('hr-HR-GabrijelaNeural'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  PLAYGROUND_PORT: z.coerce.number().default(4321),
  PLAYGROUND_HOST: z.string().default('127.0.0.1'),
});

const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));
if (!parsed.success) {
  // Names only, never values.
  console.error(`\nMissing or invalid settings: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  console.error('Copy .env.playground.example to .env.playground in the repository root and fill it in.\n');
  process.exit(1);
}
const cfg = parsed.data;

const db = Db.fromUrl(cfg.DATABASE_URL, 5);
try {
  await db.query('select 1');
} catch (e) {
  console.error(`\nCould not connect to the database: ${(e as Error).message}\nCheck DATABASE_URL (Supabase → Connect → Session pooler).\n`);
  process.exit(1);
}

const google = cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET ? { clientId: cfg.GOOGLE_CLIENT_ID, clientSecret: cfg.GOOGLE_CLIENT_SECRET } : null;
const booking = new BookingService({ db, resolveCalendar: calendarResolver(db, new VaultSecretStore(db), google) });

let voice: Parameters<typeof createPlayground>[0]['voice'] = null;
if (cfg.DEEPGRAM_API_KEY) {
  const languages: Array<'en' | 'hr'> = ['en'];
  if (cfg.AZURE_SPEECH_KEY) languages.push('hr');
  voice = {
    stt: new DeepgramStt({ apiKey: cfg.DEEPGRAM_API_KEY, host: cfg.DEEPGRAM_BASE, model: cfg.DEEPGRAM_STT_MODEL }),
    tts: new LanguageRoutedTts({
      en: new DeepgramAuraTts({ apiKey: cfg.DEEPGRAM_API_KEY, host: cfg.DEEPGRAM_BASE, defaultVoice: cfg.DEEPGRAM_TTS_VOICE_EN }),
      hr: cfg.AZURE_SPEECH_KEY
        ? new AzureTts({ key: cfg.AZURE_SPEECH_KEY, region: cfg.AZURE_SPEECH_REGION, voices: { hr: cfg.AZURE_TTS_VOICE_HR } })
        : new UnavailableTts('No Croatian voice configured'),
    }),
    languages,
  };
}

console.log('Preparing demo businesses…');
const businesses = await ensureDemoBusinesses(db, (m) => console.log(`  ${m}`));

const server = createPlayground({
  db,
  booking,
  model: new OpenAICompatibleChatModel({ baseUrl: cfg.LLM_BASE_URL, apiKey: cfg.LLM_API_KEY, model: cfg.LLM_MODEL, authHeader: cfg.LLM_AUTH_HEADER }),
  modelLabel: `${cfg.LLM_MODEL} @ ${new URL(cfg.LLM_BASE_URL).host}`,
  businesses,
  voice,
  log: (event, data) => {
    if (event.startsWith('playground.')) console.log(`  ${event} ${JSON.stringify(data ?? {})}`);
  },
});

server.listen(cfg.PLAYGROUND_PORT, cfg.PLAYGROUND_HOST, () => {
  console.log(`\nPlayground ready: http://localhost:${cfg.PLAYGROUND_PORT}`);
  console.log(`  AI model: ${cfg.LLM_MODEL}`);
  console.log(`  Voice: ${voice ? `on (${voice.languages.join(', ')})` : 'off — add DEEPGRAM_API_KEY to talk out loud'}`);
  console.log('  Press Ctrl+C to stop.\n');
});

process.on('SIGINT', () => {
  server.close();
  void db.end().finally(() => process.exit(0));
});
