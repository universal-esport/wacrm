import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversation: { id: 'conv-1' } as { id: string } | null,
  inbound: [{ message_id: 'wamid.IN' }] as { message_id: string }[],
  eqCalls: [] as [string, unknown][],
  sendTypingIndicator: vi.fn(async () => undefined),
}));

function fakeSupabase() {
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          mocks.eqCalls.push([column, value]);
          return builder;
        },
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: mocks.conversation, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => void) =>
          resolve({ data: table === 'messages' ? mocks.inbound : [], error: null }),
      };
      return builder;
    },
  };
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: fakeSupabase(),
    accountId: 'account-1',
  })),
}));
vi.mock('@/lib/flows/meta-send', () => ({
  loadAccountMetaCredentials: vi.fn(async () => ({
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
  })),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: mocks.sendTypingIndicator,
}));

import { POST } from './route';

const call = () =>
  POST(new Request('https://x.test/api/v1/conversations/conv-1/typing', { method: 'POST' }), {
    params: Promise.resolve({ id: 'conv-1' }),
  });

describe('POST /api/v1/conversations/{id}/typing', () => {
  beforeEach(() => {
    mocks.conversation = { id: 'conv-1' };
    mocks.inbound = [{ message_id: 'wamid.IN' }];
    mocks.eqCalls = [];
    mocks.sendTypingIndicator.mockClear();
  });

  it('shows typing on the latest inbound message, scoped to the account', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.whatsapp_message_id).toBe('wamid.IN');
    expect(mocks.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      messageId: 'wamid.IN',
    });
    expect(mocks.eqCalls).toContainEqual(['account_id', 'account-1']);
    expect(mocks.eqCalls).toContainEqual(['sender_type', 'customer']);
  });

  it('404s for a conversation outside the account', async () => {
    mocks.conversation = null;
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.sendTypingIndicator).not.toHaveBeenCalled();
  });

  it('404s when there is no inbound message', async () => {
    mocks.inbound = [];
    expect((await call()).status).toBe(404);
  });

  it('maps a Meta failure to 502 meta_error', async () => {
    mocks.sendTypingIndicator.mockRejectedValueOnce(new Error('boom'));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('meta_error');
  });
});
