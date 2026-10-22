// ============================================================
// POST /api/v1/conversations/{id}/typing — mark the contact's latest
// inbound message as read and show "typing…" on their phone
// (scope: messages:send).
//
// For external bots that answer through `POST /api/v1/messages`: call
// this as soon as a reply is being prepared. Meta clears the indicator
// after 25 seconds or when the next message is sent, so there is
// nothing to cancel. Meta asks that it only be shown when a reply is
// actually coming.
//
// Response (200): { "data": { "whatsapp_message_id": "wamid.…" } }
// 404 when the conversation is in another account or has no inbound
// message; 502 when Meta rejects the call (e.g. message older than the
// 30-day read-receipt window).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { loadAccountMetaCredentials } from '@/lib/flows/meta-send';
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;

    const { data: conversation, error: convErr } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (convErr) {
      console.error('[api/v1/typing] conversation read error:', convErr);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!conversation) return fail('not_found', 'Conversation not found', 404);

    const { data: rows, error: msgErr } = await ctx.supabase
      .from('messages')
      .select('message_id')
      .eq('conversation_id', id)
      .eq('sender_type', 'customer')
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (msgErr) {
      console.error('[api/v1/typing] message read error:', msgErr);
      return fail('internal', 'Failed to read messages', 500);
    }
    const wamid = rows?.[0]?.message_id as string | undefined;
    if (!wamid) return fail('not_found', 'No inbound message to answer', 404);

    let credentials: { phoneNumberId: string; accessToken: string };
    try {
      credentials = await loadAccountMetaCredentials(ctx.supabase, ctx.accountId);
    } catch {
      return fail('whatsapp_not_configured', 'WhatsApp is not configured', 400);
    }

    try {
      await sendTypingIndicator({ ...credentials, messageId: wamid });
    } catch (err) {
      console.warn('[api/v1/typing] Meta rejected typing indicator:', err);
      return fail('meta_error', 'Meta rejected the typing indicator', 502);
    }

    return ok({ whatsapp_message_id: wamid });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
