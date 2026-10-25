import { RATES } from './rates';

export type Stack = 'eu_native' | 'vapi_eu' | 'retell';
export type LlmTier = 'small' | 'medium';

export interface TrafficProfile {
  country: 'IE' | 'HR';
  language: 'en' | 'hr';
  stack: Stack;
  llmTier: LlmTier;
}

/** Behavioural assumptions — every one is a knob, shown in the report. */
export interface UsageAssumptions {
  agentTalkShare: number; // fraction of call minutes where TTS audio is generated
  llmInputTokensPerMin: number; // prompt + history re-sent each turn
  llmOutputTokensPerMin: number;
  transferMinuteShare: number; // fraction of minutes bridged to a staff phone
  overheadFactor: number; // retries, short/failed calls, rounding to whole minutes by carriers
  usdToEur: number;
}

export const DEFAULT_ASSUMPTIONS: UsageAssumptions = {
  agentTalkShare: 0.45,
  llmInputTokensPerMin: 12_000,
  llmOutputTokensPerMin: 300,
  transferMinuteShare: 0.05,
  overheadFactor: 1.15,
  usdToEur: 0.86, // ASSUMPTION — set from treasury rate when invoicing
};

export interface PerMinuteBreakdown {
  telephony: number;
  media: number;
  stt: number;
  llm: number;
  tts: number;
  platform: number;
  transfers: number;
  total: number; // USD per billed caller minute, fully loaded (variable only)
  unverifiedInputs: string[];
}

export function costPerMinute(p: TrafficProfile, a: UsageAssumptions = DEFAULT_ASSUMPTIONS): PerMinuteBreakdown {
  const unverified = new Set<string>();
  const use = <K extends keyof typeof RATES>(k: K): number => {
    const r = RATES[k];
    if (!r.verified) unverified.add(k);
    return r.currency === 'EUR' ? r.value / a.usdToEur : r.value;
  };

  const telephony =
    p.country === 'IE' ? use('twilio_ie_local_inbound_per_min') : use('hr_local_sip_inbound_per_min') + use('twilio_sip_per_min');
  const transfers =
    a.transferMinuteShare *
    (p.country === 'IE' ? use('twilio_ie_outbound_mobile_per_min') : use('twilio_hr_outbound_mobile_from_eea_per_min'));

  let media = 0;
  let stt = 0;
  let tts = 0;
  let llm = 0;
  let platform = 0;

  const llmCost =
    p.llmTier === 'small'
      ? (a.llmInputTokensPerMin * use('mistral_small_input_per_mtok') + a.llmOutputTokensPerMin * use('mistral_small_output_per_mtok')) / 1e6
      : (a.llmInputTokensPerMin * use('mistral_medium_input_per_mtok') + a.llmOutputTokensPerMin * use('mistral_medium_output_per_mtok')) / 1e6;

  if (p.stack === 'eu_native') {
    media = use('twilio_media_streams_per_min');
    stt = p.language === 'hr' ? use('soniox_realtime_stt_per_min') : use('deepgram_nova3_streaming_mono_per_min');
    tts = a.agentTalkShare * (p.language === 'hr' ? use('soniox_tts_per_audio_min') : use('generic_tts_per_audio_min'));
    llm = llmCost;
  } else if (p.stack === 'vapi_eu') {
    platform = use('vapi_platform_per_min');
    stt = p.language === 'hr' ? use('soniox_realtime_stt_per_min') : use('deepgram_nova3_streaming_mono_per_min');
    tts = a.agentTalkShare * use('generic_tts_per_audio_min');
    llm = llmCost;
  } else {
    platform = use('retell_base_per_min'); // bundled voice engine; LLM billed on top
    llm = llmCost;
  }

  const raw = telephony + media + stt + llm + tts + platform + transfers;
  const total = raw * a.overheadFactor;
  return { telephony, media, stt, llm, tts, platform, transfers, total, unverifiedInputs: [...unverified].sort() };
}

/** Fixed monthly platform costs (USD). All ASSUMPTIONS until accounts exist — see docs/cost-model.md. */
export const PLATFORM_FIXED_MONTHLY = {
  supabase: 25,
  voiceGatewayHosting: 40,
  webHosting: 20,
  monitoring: 26,
  email: 20,
} as const;

export function platformFixedMonthly(clientCount: number): number {
  const base = Object.values(PLATFORM_FIXED_MONTHLY).reduce((s, v) => s + v, 0);
  // Step costs: a second gateway instance for redundancy from 20 clients, bigger DB from 100, extra capacity from 300.
  const steps = (clientCount >= 20 ? 40 : 0) + (clientCount >= 100 ? 75 : 0) + (clientCount >= 300 ? 200 : 0);
  return base + steps;
}

export function tenantFixedMonthly(country: 'IE' | 'HR'): number {
  return country === 'IE' ? RATES.twilio_ie_local_number_per_month.value : 5; // HR: ASSUMPTION pending carrier quote
}

export interface PlanEconomicsInput {
  priceEurMonthly: number;
  includedMinutes: number;
  profile: TrafficProfile;
  clientCount: number;
  paymentFeePct?: number; // ASSUMPTION — confirm Stripe EEA card + Billing rates
  paymentFeeFixedEur?: number;
  assumptions?: UsageAssumptions;
}

export interface PlanEconomics {
  costPerMinUsd: number;
  variableCostEur: number;
  tenantFixedEur: number;
  platformShareEur: number;
  paymentFeesEur: number;
  totalCostEur: number;
  grossMarginEur: number;
  grossMarginPct: number;
  breakEvenMinutes: number;
}

export function planEconomics(i: PlanEconomicsInput): PlanEconomics {
  const a = i.assumptions ?? DEFAULT_ASSUMPTIONS;
  const fx = a.usdToEur;
  const perMin = costPerMinute(i.profile, a).total;
  const variableCostEur = i.includedMinutes * perMin * fx;
  const tenantFixedEur = tenantFixedMonthly(i.profile.country) * fx;
  const platformShareEur = (platformFixedMonthly(i.clientCount) * fx) / Math.max(1, i.clientCount);
  const paymentFeesEur = i.priceEurMonthly * (i.paymentFeePct ?? 0.022) + (i.paymentFeeFixedEur ?? 0.25);
  const totalCostEur = variableCostEur + tenantFixedEur + platformShareEur + paymentFeesEur;
  const grossMarginEur = i.priceEurMonthly - totalCostEur;
  const fixedPart = tenantFixedEur + platformShareEur + paymentFeesEur;
  const breakEvenMinutes = Math.max(0, Math.floor((i.priceEurMonthly - fixedPart) / (perMin * fx)));
  return {
    costPerMinUsd: perMin,
    variableCostEur,
    tenantFixedEur,
    platformShareEur,
    paymentFeesEur,
    totalCostEur,
    grossMarginEur,
    grossMarginPct: i.priceEurMonthly > 0 ? grossMarginEur / i.priceEurMonthly : 0,
    breakEvenMinutes,
  };
}

/** Lowest price that keeps `targetMargin` at full use of the included minutes. */
export function minimumViablePriceEur(
  includedMinutes: number,
  profile: TrafficProfile,
  clientCount: number,
  targetMargin = 0.7,
  assumptions: UsageAssumptions = DEFAULT_ASSUMPTIONS,
): number {
  const fx = assumptions.usdToEur;
  const perMin = costPerMinute(profile, assumptions).total * fx;
  const fixed = tenantFixedMonthly(profile.country) * fx + (platformFixedMonthly(clientCount) * fx) / Math.max(1, clientCount) + 0.25;
  const pct = 0.022;
  // price - (price*pct + fixed + mins*perMin) = margin*price  →  price = (fixed + mins*perMin) / (1 - pct - margin)
  return Math.ceil((fixed + includedMinutes * perMin) / (1 - pct - targetMargin));
}
