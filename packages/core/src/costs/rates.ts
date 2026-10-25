/**
 * Provider rate card. Every number carries its provenance so the cost model never presents
 * a guess as a fact. `verified: true` = read from the provider's own published page on `asOf`.
 * All amounts in USD unless `currency` says otherwise. Update via a reviewed PR, never ad hoc.
 */
export interface Rate {
  value: number;
  unit: string;
  currency: 'USD' | 'EUR';
  source: string;
  asOf: string;
  verified: boolean;
  note?: string;
}

export const RATES = {
  twilio_ie_local_inbound_per_min: {
    value: 0.01, unit: 'min', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://www.twilio.com/en-us/voice/pricing/ie (page states pricing current as of Aug 2026)',
  },
  twilio_ie_local_number_per_month: {
    value: 1.8, unit: 'month', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://www.twilio.com/en-us/voice/pricing/ie',
  },
  twilio_ie_outbound_mobile_per_min: {
    value: 0.0945, unit: 'min', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://www.twilio.com/en-us/voice/pricing/ie', note: 'Used for warm/cold transfers to a staff mobile.',
  },
  twilio_sip_per_min: {
    value: 0.004, unit: 'min', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://www.twilio.com/en-us/voice/pricing/ie (SIP interface / BYOC)',
  },
  twilio_hr_tollfree_inbound_per_min: {
    value: 0.315, unit: 'min', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://www.twilio.com/voice/pricing/hr', note: 'Prohibitive; Croatian local inbound price not published on that page.',
  },
  twilio_hr_outbound_mobile_from_eea_per_min: {
    value: 0.095, unit: 'min', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://www.twilio.com/voice/pricing/hr ("Croatia - Mobile - From Eea")',
  },
  hr_local_sip_inbound_per_min: {
    value: 0.01, unit: 'min', currency: 'EUR', verified: false, asOf: '2026-10-25',
    source: 'ASSUMPTION — Croatian SIP carrier (BYOC) rate not yet quoted', note: 'Blocker: obtain quotes from a Croatian operator.',
  },
  twilio_media_streams_per_min: {
    value: 0.004, unit: 'min', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'ASSUMPTION — confirm Media Streams pricing on Twilio account', note: 'Conservative placeholder.',
  },
  deepgram_nova3_streaming_mono_per_min: {
    value: 0.0077, unit: 'min', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'Third-party summary (activepieces.com, 2026-10-23) lists $0.0048 promo; $0.0077 used as conservative list rate',
  },
  soniox_realtime_stt_per_min: {
    value: 0.002, unit: 'min', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://soniox.com/platform/croatian ($0.12/hour real-time)',
  },
  soniox_tts_per_audio_min: {
    value: 0.0117, unit: 'audio-min', currency: 'USD', verified: true, asOf: '2026-10-25',
    source: 'https://soniox.com/platform/croatian ($0.70/hour generated audio)', note: 'Croatian voice quality must be evaluated before use.',
  },
  generic_tts_per_audio_min: {
    value: 0.015, unit: 'audio-min', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'ASSUMPTION — EU-resident neural TTS placeholder (Deepgram Aura EU / Azure / ElevenLabs EU) pending quotes',
  },
  mistral_small_input_per_mtok: {
    value: 0.1, unit: 'Mtok', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'Third-party summary (developer.puter.com, updated 2026-10-20) of Mistral Small 4 pricing',
  },
  mistral_small_output_per_mtok: {
    value: 0.3, unit: 'Mtok', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'Third-party summary (developer.puter.com, updated 2026-10-20)',
  },
  mistral_medium_input_per_mtok: {
    value: 1.5, unit: 'Mtok', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'Third-party summary (developer.puter.com, updated 2026-10-20) of Mistral Medium 3.5',
  },
  mistral_medium_output_per_mtok: {
    value: 7.5, unit: 'Mtok', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'Third-party summary (developer.puter.com, updated 2026-10-20)',
  },
  vapi_platform_per_min: {
    value: 0.05, unit: 'min', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'Third-party summary (activepieces.com, 2026-10-16); EU region requires Premier Success package (docs.vapi.ai/security-and-privacy/eu-region)',
  },
  retell_base_per_min: {
    value: 0.07, unit: 'min', currency: 'USD', verified: false, asOf: '2026-10-25',
    source: 'retellai.com blog 2026-10-21; NO EU region per Retell staff (community.retellai.com, 2026-05-01)',
  },
} as const satisfies Record<string, Rate>;

export type RateKey = keyof typeof RATES;
