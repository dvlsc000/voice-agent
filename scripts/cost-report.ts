// Prints the unit-economics tables used in docs/cost-model.md. Run: pnpm --filter @vp/core exec tsx ../../scripts/cost-report.ts
import { costPerMinute, minimumViablePriceEur, planEconomics, platformFixedMonthly, type TrafficProfile } from '../packages/core/src/index';

const profiles: Array<[string, TrafficProfile]> = [
  ['IE · English · EU-native', { country: 'IE', language: 'en', stack: 'eu_native', llmTier: 'small' }],
  ['IE · English · EU-native, larger LLM', { country: 'IE', language: 'en', stack: 'eu_native', llmTier: 'medium' }],
  ['HR · Croatian · EU-native', { country: 'HR', language: 'hr', stack: 'eu_native', llmTier: 'small' }],
  ['HR · English · EU-native', { country: 'HR', language: 'en', stack: 'eu_native', llmTier: 'small' }],
  ['IE · English · Vapi (EU region)', { country: 'IE', language: 'en', stack: 'vapi_eu', llmTier: 'small' }],
  ['IE · English · Retell (no EU region)', { country: 'IE', language: 'en', stack: 'retell', llmTier: 'small' }],
];
const f = (n: number, d = 4) => n.toFixed(d);
console.log('## Variable cost per caller minute (USD, fully loaded incl. 15% overhead)\n');
console.log('| Profile | Telephony | STT | LLM | TTS | Platform | Transfers | **Total/min** |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [name, p] of profiles) {
  const c = costPerMinute(p);
  console.log(`| ${name} | ${f(c.telephony + c.media)} | ${f(c.stt)} | ${f(c.llm)} | ${f(c.tts)} | ${f(c.platform)} | ${f(c.transfers)} | **${f(c.total)}** |`);
}
console.log('\n## Monthly variable cost by volume (USD)\n');
const vols = [100, 500, 1000, 5000, 10000, 50000];
console.log(`| Profile | ${vols.map((v) => `${v.toLocaleString('en-IE')} min`).join(' | ')} |`);
console.log(`|---|${vols.map(() => '---').join('|')}|`);
for (const [name, p] of profiles) {
  const c = costPerMinute(p).total;
  console.log(`| ${name} | ${vols.map((v) => (c * v).toFixed(0)).join(' | ')} |`);
}
console.log('\n## Fixed platform cost by client count (USD/month, assumption)\n');
console.log('| Clients | Platform fixed | Per client |');
console.log('|---|---|---|');
for (const n of [5, 20, 50, 100, 500]) console.log(`| ${n} | ${platformFixedMonthly(n)} | ${(platformFixedMonthly(n) / n).toFixed(2)} |`);
console.log('\n## Minimum price for a 70% gross margin at full allowance (EUR/month, IE English, EU-native, 50 clients)\n');
console.log('| Included minutes | Min. price | Break-even minutes at that price | ');
console.log('|---|---|---|');
const ie: TrafficProfile = { country: 'IE', language: 'en', stack: 'eu_native', llmTier: 'small' };
for (const mins of [150, 300, 600, 1200]) {
  const price = minimumViablePriceEur(mins, ie, 50, 0.7);
  const e = planEconomics({ priceEurMonthly: price, includedMinutes: mins, profile: ie, clientCount: 50 });
  console.log(`| ${mins} | €${price} | ${e.breakEvenMinutes.toLocaleString('en-IE')} |`);
}
console.log('\nUnverified inputs (EU-native IE):', costPerMinute(ie).unverifiedInputs.join(', '));
