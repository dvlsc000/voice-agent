import { describe, expect, it } from 'vitest';
import { AudioCallSession } from '../src/call/session';
import { FakeActions, FakeSink, FakeStt, FakeTts, makeEngine, tick } from './fakes';

function setup(steps: Parameters<typeof makeEngine>[0], opts: { fallback?: string | null; toolResult?: Parameters<typeof makeEngine>[1]; timings?: Record<string, number> } = {}) {
  const { engine, executed } = makeEngine(steps, opts.toolResult);
  const stt = new FakeStt();
  const tts = new FakeTts();
  const sink = new FakeSink();
  const actions = new FakeActions();
  const events: string[] = [];
  const session = new AudioCallSession(engine, stt, tts, sink, actions, {
    fallbackPhone: opts.fallback === undefined ? '+35391123456' : opts.fallback,
    timings: { silenceRepromptMs: 60_000, ...opts.timings },
    log: (e) => events.push(e),
  });
  sink.onMark = (n) => session.onMark(n);
  return { engine, executed, stt, tts, sink, actions, session, events };
}

describe('audio call session', () => {
  it('greets, answers a turn sentence by sentence, and measures latency', async () => {
    const t = setup([() => ({ text: "We're open nine to six. Anything else?" })]);
    await t.session.start();
    expect(t.sink.played[0]).toMatch(/virtual assistant/);
    t.stt.say('What time are you open till?');
    await tick(20);
    expect(t.sink.played.slice(1)).toEqual(["We're open nine to six.", 'Anything else?']);
    expect(t.session.metrics.responseLatencies).toHaveLength(1);
    expect(t.session.metrics.responseLatencies[0]).toBeLessThan(1000);
    await t.session.close();
  });

  it('caller barge-in clears queued audio and keeps only what was actually heard', async () => {
    const t = setup([() => ({ text: 'Sentence one. Sentence two. Sentence three.' }), () => ({ text: 'Sure, Thursday then.' })]);
    await t.session.start();
    await tick(5);
    t.sink.holdMarks = true;
    t.stt.say('Have you anything Tuesday?');
    await tick(20);
    t.sink.onMark(t.sink.heldMarks.shift()!); // only "Sentence one." finished playing
    t.stt.interim('Actually no wait');
    expect(t.sink.clears).toBe(1);
    expect(t.session.metrics.bargeIns).toBe(1);
    const lastAgent = [...t.engine.messages].reverse().find((m) => m.role === 'assistant');
    expect(lastAgent?.content).toBe('Sentence one.…');
    t.sink.holdMarks = false;
    t.stt.say('Actually no wait, Thursday');
    await tick(20);
    expect(t.sink.played.at(-1)).toBe('Sure, Thursday then.');
    await t.session.close();
  });

  it('a single word while the agent talks ("mm") does not interrupt', async () => {
    const t = setup([() => ({ text: 'Long answer here. And more.' })]);
    await t.session.start();
    await tick(5); // greeting finished playing
    t.sink.holdMarks = true;
    t.stt.say('question');
    await tick(20);
    t.stt.interim('mm');
    expect(t.sink.clears).toBe(0);
    await t.session.close();
  });

  it('transfers after the closing line has played', async () => {
    const t = setup([() => ({ text: 'Putting you through.', toolCalls: [{ name: 'transfer_to_human', arguments: '{"reason":"asked"}' }] })], {
      toolResult: { ok: true, action: { type: 'transfer', target: '+35391123456' } },
    });
    await t.session.start();
    t.stt.say('I need to talk to Mark about an order');
    await tick(30);
    expect(t.actions.transfers).toEqual(['+35391123456']);
    expect(t.session.endedBy).toBe('agent');
  });

  it('re-prompts on silence, then ends the call politely', async () => {
    const t = setup([() => ({ text: 'unused' })], { timings: { silenceRepromptMs: 15, maxSilenceReprompts: 1 } });
    await t.session.start();
    await tick(120);
    expect(t.sink.played).toContain('Are you still there?');
    expect(t.sink.played.at(-1)).toMatch(/call back any time/);
    expect(t.actions.hangups).toBe(1);
    expect(t.session.endedBy).toBe('timeout');
  });

  it('enforces the maximum call length', async () => {
    const t = setup([() => ({ text: 'ok' })], { timings: { maxCallMs: 30 } });
    await t.session.start();
    await tick(80);
    expect(t.sink.played.at(-1)).toMatch(/wrap up this call/);
    expect(t.actions.hangups).toBe(1);
  });

  it('speech recognition failure hands the caller to the business, never a dead line', async () => {
    const t = setup([() => ({ text: 'ok' })]);
    await t.session.start();
    t.stt.fail();
    await tick(30);
    expect(t.sink.played).toContain("Sorry, I'm having trouble hearing you.");
    expect(t.actions.transfers).toEqual(['+35391123456']);
  });

  it('with no fallback number, a failure ends with a call-back request instead of silence', async () => {
    const t = setup([() => ({ text: 'ok' })], { fallback: null });
    await t.session.start();
    t.stt.fail();
    await tick(30);
    expect(t.sink.played.at(-1)).toMatch(/call back a little later/);
    expect(t.actions.hangups).toBe(1);
    expect(t.engine.outcome()).toBe('failed');
  });

  it('if the transfer itself fails, the caller stays on the line with the assistant', async () => {
    const t = setup([() => ({ text: 'Connecting.', toolCalls: [{ name: 'transfer_to_human', arguments: '{"reason":"x"}' }] })], {
      toolResult: { ok: true, action: { type: 'transfer', target: '+35391123456' } },
    });
    t.actions.failTransfer = true;
    await t.session.start();
    t.stt.say('put me through');
    await tick(30);
    expect(t.events).toContain('transfer.failed');
    expect(t.session.endedBy).toBeNull();
    await t.session.close();
  });
});
