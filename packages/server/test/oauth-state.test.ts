import { describe, expect, it } from 'vitest';
import { signState, verifyState } from '../src/oauth-state';

const secret = 's'.repeat(40);
describe('OAuth state', () => {
  it('round-trips only with the matching browser nonce', () => {
    const { state, nonce } = signState(secret, { org: 'o1', uid: 'u1' });
    expect(verifyState(secret, state, nonce)).toMatchObject({ org: 'o1', uid: 'u1' });
    expect(verifyState(secret, state, 'other-browser')).toBeNull();
    expect(verifyState(secret, state, undefined)).toBeNull();
  });
  it('rejects tampering and other secrets', () => {
    const { state, nonce } = signState(secret, { org: 'o1', uid: 'u1' });
    const [payload, mac] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), org: 'victim' })).toString('base64url');
    expect(verifyState(secret, `${forged}.${mac}`, nonce)).toBeNull();
    expect(verifyState('x'.repeat(40), state, nonce)).toBeNull();
  });
});
