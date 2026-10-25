import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { BARBERSHOP, DENTAL, compileAgent, toolsForCapabilities, type AgentSettings, type Capability } from '@vp/core';
import {
  BookingService,
  ConversationEngine,
  Db,
  OpenAICompatibleChatModel,
  ScriptedChatModel,
  ToolExecutor,
  provisionClient,
  renderBusinessFacts,
  takeSentences,
  type CallSession,
  type EngineOutput,
} from '../src/index';

const db = Db.fromUrl(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54329/postgres');
let org: string;
let staffId: string;
let serviceId: string;
const tools = new ToolExecutor({ db, booking: new BookingService({ db }) });

const settings = (caps: Capability[]): AgentSettings => ({
  agentName: 'Nora', primaryLanguage: 'en', additionalLanguages: [], allowLanguageSwitch: false, formality: 'neutral',
  enabledCapabilities: caps, voice: { provider: 'x', voiceId: 'x', speed: 1 }, pronunciations: [], customInstructions: '',
  maxCallDurationSec: 900, recordingEnabled: false, transcriptsEnabled: true,
});

async function session(caps: Capability[]): Promise<CallSession> {
  const callId = (await db.query(`insert into public.calls (organization_id, provider, provider_call_id, started_at, from_e164) values ($1, 'sim', $2, now(), '+353871234567') returning id`, [org, randomUUID()])).rows[0].id;
  return {
    ctx: { organizationId: org, callId, agentVersionId: 'v', enabledCapabilities: caps, agentToolAllowlist: toolsForCapabilities(caps), verifiedBookingIds: new Set(), offeredSlots: new Set(), toolCallsSoFar: 0, consequentialCallsSoFar: 0, organizationStatus: 'active' },
    callerIdE164: '+353871234567', timezone: 'Europe/Dublin', language: 'en', verificationAttempts: 0,
  };
}

async function collect(gen: AsyncGenerator<EngineOutput>): Promise<EngineOutput[]> {
  const out: EngineOutput[] = [];
  for await (const o of gen) out.push(o);
  return out;
}
const said = (o: EngineOutput[]) => o.filter((x) => x.type === 'say').map((x) => (x as { text: string }).text).join(' ');

beforeAll(async () => {
  const r = await provisionClient(db, {
    businessName: 'Engine Barbers', industry: 'barbershop', country: 'IE', primaryLanguage: 'en',
    contactEmail: 'o@e.test', ownerEmail: 'o@e.test', fallbackPhone: '091 123 456',
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: '09:00', closes: '18:00' })), staff: [{ name: 'Mark' }],
  }, { actorUserId: null, idempotencyKey: randomUUID() });
  org = r.organizationId;
  await db.query(`update public.organizations set status = 'active' where id = $1`, [org]);
  staffId = (await db.query(`select id from public.staff_members where organization_id = $1`, [org])).rows[0].id;
  serviceId = (await db.query(`select id from public.services where organization_id = $1 order by sort_order limit 1`, [org])).rows[0].id;
});
afterAll(() => db.end());

describe('sentence splitting for low-latency speech', () => {
  it('emits complete sentences and keeps prices intact', () => {
    expect(takeSentences('That costs €25.00 for a fade. Want to book? Yes')).toEqual({ sentences: ['That costs €25.00 for a fade.', 'Want to book?'], rest: 'Yes' });
    expect(takeSentences('Grand', true)).toEqual({ sentences: ['Grand'], rest: '' });
  });
});

describe('conversation engine', () => {
  it('runs a full booking: model asks availability, offers a time, books only after the tool confirms', async () => {
    const caps: Capability[] = ['reception', 'booking', 'messages', 'human_handoff'];
    const s = await session(caps);
    const facts = await renderBusinessFacts(db, org, 'en');
    const agent = compileAgent(BARBERSHOP, settings(caps), { businessName: 'Engine Barbers', timezone: 'Europe/Dublin', factsText: facts });
    const day = DateTime.now().setZone('Europe/Dublin').plus({ days: 2 }).toISODate()!;
    let offered: { staff_id: string; start: string; spoken: string } | undefined;
    const model = new ScriptedChatModel([
      () => ({ toolCalls: [{ name: 'check_availability', arguments: JSON.stringify({ service_id: serviceId, staff_id: staffId, date: day, day_part: 'afternoon' }) }] }),
      ({ lastToolResult }) => {
        offered = (lastToolResult as any).data.options[0];
        return { text: `I have ${offered!.spoken}. Does that suit?` };
      },
      () => ({ text: 'Lovely, booking that now.', toolCalls: [{ name: 'book_appointment', arguments: JSON.stringify({ service_id: serviceId, staff_id: offered!.staff_id, start: offered!.start, customer_name: 'Seán Murphy', customer_phone: '+353871234567', caller_confirmed: true }) }] }),
      ({ lastToolResult }) => ({ text: `You're booked. Your reference is ${(lastToolResult as any).data.reference_spoken}.` }),
    ]);
    const engine = new ConversationEngine({ model, tools }, s, agent, BARBERSHOP);
    expect(engine.greeting()).toMatch(/virtual assistant/);
    const t1 = await collect(engine.respond('Can I get a haircut with Mark the day after tomorrow, afternoon?'));
    expect(said(t1)).toMatch(/^I have .* (pm|am)\. Does that suit\?$/);
    const t2 = await collect(engine.respond("Yeah perfect, it's Seán Murphy"));
    expect(said(t2)).toMatch(/You're booked\. Your reference is \d( \d){5}\./);
    expect(engine.outcome()).toBe('booked');
    expect(engine.transcript.filter((x) => x.role === 'caller')).toHaveLength(2);
    const appt = await db.query(`select status from public.appointments where call_id = $1`, [s.ctx.callId]);
    expect(appt.rows[0].status).toBe('confirmed');
  });

  it('gives emergency instructions deterministically even if the model would not', async () => {
    const caps: Capability[] = ['reception', 'booking', 'messages'];
    const s = await session(caps);
    const agent = compileAgent(DENTAL, settings(caps), { businessName: 'Smile Dental', timezone: 'Europe/Dublin', factsText: '' });
    const model = new ScriptedChatModel([() => ({ text: 'Would you like me to arrange an urgent callback?' })]);
    const engine = new ConversationEngine({ model, tools }, s, agent, DENTAL);
    const out = await collect(engine.respond("I've chest pain and my tooth is bleeding"));
    expect(said(out)).toMatch(/^This sounds like an emergency\. Please hang up and call 112 straight away\./);
    expect(engine.outcome()).toBe('escalated');
    expect(engine.messages[0]!.role === 'system' && engine.messages[0]!.content).toMatch(/Emergency instructions were already given/);
  });

  it('transfers immediately when the caller asks for a person', async () => {
    const caps: Capability[] = ['reception', 'messages', 'human_handoff'];
    const s = await session(caps);
    const agent = compileAgent(BARBERSHOP, settings(caps), { businessName: 'Engine Barbers', timezone: 'Europe/Dublin', factsText: '' });
    const engine = new ConversationEngine({ model: new ScriptedChatModel([() => ({ text: 'unused' })]), tools }, s, agent, BARBERSHOP);
    const out = await collect(engine.respond('Can I speak to a real person please'));
    expect(out.find((o) => o.type === 'action')).toEqual({ type: 'action', action: { type: 'transfer', target: '+35391123456' } });
    expect(engine.outcome()).toBe('transferred');
  });

  it('never claims success when the model is down', async () => {
    const caps: Capability[] = ['reception', 'booking'];
    const s = await session(caps);
    const agent = compileAgent(BARBERSHOP, settings(caps), { businessName: 'Engine Barbers', timezone: 'Europe/Dublin', factsText: '' });
    const broken = new OpenAICompatibleChatModel({ baseUrl: 'https://llm.invalid/v1', apiKey: 'x', model: 'm', fetch: async () => new Response('overloaded', { status: 503 }) });
    const engine = new ConversationEngine({ model: broken, tools }, s, agent, BARBERSHOP);
    const out = await collect(engine.respond('Book me in for Tuesday'));
    expect(said(out)).toMatch(/trouble on my side/);
    expect(out.some((o) => o.type === 'event' && o.name === 'llm.failed')).toBe(true);
  });

  it('rejects malformed tool arguments without executing anything', async () => {
    const caps: Capability[] = ['reception', 'booking'];
    const s = await session(caps);
    const agent = compileAgent(BARBERSHOP, settings(caps), { businessName: 'Engine Barbers', timezone: 'Europe/Dublin', factsText: '' });
    const model = new ScriptedChatModel([
      () => ({ toolCalls: [{ name: 'book_appointment', arguments: '{not json' }] }),
      ({ lastToolResult }) => ({ text: (lastToolResult as any).ok ? 'BOOKED' : 'Could you give me those details again?' }),
    ]);
    const engine = new ConversationEngine({ model, tools }, s, agent, BARBERSHOP);
    const out = await collect(engine.respond('book it'));
    expect(said(out)).toBe('Could you give me those details again?');
    expect(engine.outcome()).toBe('other');
  });
});

describe('OpenAI-compatible streaming client', () => {
  it('parses streamed text and fragmented tool calls', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"One "}}]}',
      'data: {"choices":[{"delta":{"content":"moment."}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"check_availability","arguments":"{\\"date\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"2030-01-01\\"}"}}]}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    let sentBody: any;
    const model = new OpenAICompatibleChatModel({
      baseUrl: 'https://api.mistral.ai/v1', apiKey: 'k', model: 'mistral-small-latest',
      fetch: async (_url, init) => {
        sentBody = JSON.parse(String(init!.body));
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const events = [];
    for await (const e of model.stream({ messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'check_availability', description: 'd', parameters: { type: 'object' } }] })) events.push(e);
    expect(events).toEqual([
      { type: 'text', delta: 'One ' },
      { type: 'text', delta: 'moment.' },
      { type: 'tool_call', call: { id: 'c1', name: 'check_availability', arguments: '{"date":"2030-01-01"}' } },
      { type: 'done', usage: { inputTokens: 12, outputTokens: 3 } },
    ]);
    expect(sentBody.tools[0].function.name).toBe('check_availability');
    expect(sentBody.stream).toBe(true);
  });
});
