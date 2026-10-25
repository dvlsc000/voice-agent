import { z } from 'zod';

/** All configuration comes from the environment (secrets from the host's secret store). Validated at boot. */
const schema = z.object({
  PORT: z.coerce.number().default(8080),
  PUBLIC_BASE_URL: z.string().url(), // https://voice.example.com — used for webhook signature checks and stream URL
  DATABASE_URL: z.string().startsWith('postgres'),
  STREAM_TOKEN_SECRET: z.string().min(32), // signs per-call stream tokens
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string().min(16),
  TWILIO_REGION: z.enum(['ie1', 'us1']).default('ie1'),
  DEEPGRAM_API_KEY: z.string().min(10),
  DEEPGRAM_BASE: z.string().default('api.eu.deepgram.com'),
  DEEPGRAM_STT_MODEL: z.string().default('nova-3'),
  DEEPGRAM_TTS_VOICE_EN: z.string().default('aura-2-thalia-en'),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().default('westeurope'),
  AZURE_TTS_VOICE_HR: z.string().default('hr-HR-GabrijelaNeural'),
  LLM_BASE_URL: z.string().url(), // EU endpoint, e.g. https://api.mistral.ai/v1 (confirm processing region in your DPA)
  LLM_API_KEY: z.string().min(10),
  LLM_MODEL: z.string().default('mistral-small-latest'),
  LLM_AUTH_HEADER: z.enum(['bearer', 'api-key']).default('bearer'),
  SITE_URL: z.string().url().default('http://localhost:3000'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Reception <no-reply@example.com>'),
  TWILIO_SMS_FROM: z.string().optional(),
  RUN_WORKER: z.enum(['true', 'false']).default('true'),
});
export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // List missing/invalid variable NAMES only — never print values.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid voice-gateway configuration: ${names}`);
  }
  return parsed.data;
}
