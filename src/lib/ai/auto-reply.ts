import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledgeForMessages } from './knowledge'
import { generateReply } from './generate'
import { aiDebounceMs, buildSystemPrompt, limaTimeHint } from './defaults'
import {
  buildHandoffSummary,
  quoteLastCustomerMessage,
  sendNeedsReplyTelegramAlert,
  sendShipmentReadyTelegramAlert,
} from './handoff'
import {
  enforceWhatsAppEmphasis,
  stripRepeatedRecommendation,
} from './format-whatsapp'
import { getProductImage } from './product-images'
import { getShipmentStatusContext, parseShipmentSentinel, upsertShipmentFromSentinel } from './shipment'
import { pushUpdateShipment } from '@/lib/contacts/sale-sheet'
import { logAiUsage } from './usage'
import { engineSendText, engineSendMedia } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates:
 *   - AI off / auto-reply disabled for the account → silent no-op
 *   - a human agent is assigned (they own the thread) → Telegram
 *     "needs a human" alert (if configured), then no-op
 *   - auto-reply was disabled for this conversation (prior handoff) →
 *     same alert, then no-op — covers a FOLLOW-UP customer message on
 *     an already-handed-off thread, which nothing else announces
 *   - the per-conversation reply cap is reached → same alert, no-op
 *   - there's nothing to reply to → silent no-op
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Awaited (not fire-and-forget) — we're inside the webhook's
    // `after()` block, which only keeps the function alive for
    // promises the caller can see. A detached send here could get cut
    // off mid-flight the moment this function returns, silently
    // dropping the one thing the alert exists to guarantee. `detail`
    // is loaded lazily (only on the notify path) since most inbounds
    // never reach a gate that calls this. `sendNeedsReplyTelegramAlert`
    // itself no-ops when the account has no `needs_human` destination
    // configured (migration 049), so there's nothing to gate here.
    const notifyNeedsHuman = async () => {
      const detail = await quoteLastCustomerMessage(db, conversationId)
      await sendNeedsReplyTelegramAlert(db, {
        accountId,
        conversationId,
        contactId,
        reason: 'needs_human',
        detail,
      })
    }

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count, last_message_at')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) {
      // A human owns this thread — every message here needs their
      // reply, not just the first one after assignment.
      await notifyNeedsHuman()
      return
    }
    if (conv.ai_autoreply_disabled) {
      // Handed off / turned off here already. The handoff itself was
      // announced when it happened; this is a FOLLOW-UP customer
      // message on that same thread, which the original alert never
      // covered — silence here is exactly the "I have to keep
      // checking manually" gap being fixed.
      await notifyNeedsHuman()
      return
    }
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
      await notifyNeedsHuman()
      return
    }

    // Debounce: give a customer who's mid-burst (several short messages a
    // few seconds apart — "Hola" / "Kia Seltos" / "precio") a moment to
    // finish before generating a reply. Without this, each message fires
    // its own LLM call and the customer gets 2-3 overlapping/duplicate
    // replies seconds apart (observed live: the same talla recommendation
    // sent twice, 2s apart). `last_message_at` is already the
    // per-conversation "latest inbound" marker (bumped by
    // bump_conversation_on_inbound on every customer message), so it
    // doubles as a free debounce token: remember it now, sleep, then bail
    // if it moved — a newer inbound message means a later invocation of
    // this same function is now responsible for replying to the whole
    // burst (buildConversationContext below re-queries fresh, so it picks
    // up every message the customer sent during the wait).
    const debounceMs = aiDebounceMs()
    if (debounceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, debounceMs))
      const { data: recheck } = await db
        .from('conversations')
        .select('last_message_at')
        .eq('id', conversationId)
        .maybeSingle()
      if (recheck && recheck.last_message_at !== conv.last_message_at) {
        return
      }
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    // Only the text excerpts are used here — see resolvedImageUrl below
    // for why the RAG-matched document's image is never used directly.
    const { excerpts: knowledge } = await retrieveKnowledgeForMessages(
      db,
      accountId,
      config,
      messages,
    )

    // Delivery-flow grounding (migration 052): a summary of any
    // shipment already on file — best-effort, never block the reply if
    // the lookup fails.
    const shipmentContext = await getShipmentStatusContext(db, accountId, contactId)

    // The model has no other way to know the current time — the
    // conversation history it sees carries no timestamps.
    const greetingHint = limaTimeHint()
    const userPromptWithTime = config.systemPrompt
      ? `${config.systemPrompt}\n\n${greetingHint}`
      : greetingHint

    const systemPrompt = buildSystemPrompt({
      userPrompt: userPromptWithTime,
      mode: 'auto_reply',
      knowledge,
      shipmentContext,
    })

    const {
      text: rawText,
      handoff,
      handoffReason,
      noReply,
      imageKey,
      shipmentRaw,
      usage,
    } = await generateReply({
      config,
      systemPrompt,
      messages,
    })
    // Strip a re-stated talla/price/features block before formatting —
    // prompting alone doesn't reliably stop the model from re-typing
    // its own earlier recommendation on a follow-up turn (observed
    // live on a bare "Lima" reply). No-op unless that exact block was
    // already sent earlier in this conversation.
    const priorAssistantMessages = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
    const dedupedText = stripRepeatedRecommendation(
      rawText,
      priorAssistantMessages,
    )
    // Enforce bold talla/price + spacing deterministically — prompting
    // alone gets it right only some of the time. No-op on text that
    // doesn't mention a talla or an S/ price.
    const text = enforceWhatsAppEmphasis(dedupedText)

    // Persist any delivery data the model gathered this turn (migration
    // 052) — independent of noReply/handoff below, since a Lima order
    // typically hands off right after the sentinel that completes it.
    // Best-effort: a persistence failure must never affect the send.
    if (shipmentRaw) {
      try {
        const fields = parseShipmentSentinel(shipmentRaw)
        const { data: shipmentContact } = await db
          .from('contacts')
          .select('phone')
          .eq('id', contactId)
          .maybeSingle()
        const result = await upsertShipmentFromSentinel(db, {
          accountId,
          contactId,
          fields,
          contactPhone: shipmentContact?.phone ?? null,
        })
        if (result?.row && shipmentContact?.phone) {
          await pushUpdateShipment(db, accountId, {
            telefono: shipmentContact.phone,
            ciudad: result.row.city,
            direccion: result.row.delivery_address,
            agencia: result.row.agency_name,
            dni: result.row.recipient_dni,
          })
        }
        if (result?.becameReady) {
          await sendShipmentReadyTelegramAlert(db, {
            accountId,
            contactId,
            shipment: {
              region: result.row.region,
              city: result.row.city,
              agencyName: result.row.agency_name,
              deliveryAddress: result.row.delivery_address,
              deliveryReference: result.row.delivery_reference,
              recipientName: result.row.recipient_name,
              recipientDni: result.row.recipient_dni,
              recipientPhone: result.row.recipient_phone,
            },
          })
        }
      } catch (err) {
        console.error('[ai auto-reply] shipment sentinel persist failed:', err)
      }
    }

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (noReply) {
      // The model chose to simply stay quiet this turn (e.g. the
      // customer closed out with no new question) — no message, no
      // human handoff, no auto-reply state change. Unlike a handoff,
      // the bot stays fully active for whatever the customer sends
      // next, so there's nothing else to do here.
      return
    }

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)

      // Awaited, not fire-and-forget — see notifyNeedsHuman above. The
      // handoff state itself is already persisted at this point either
      // way, so a slow/failed Telegram call can't undo it. `handoffReason`
      // (from an optional `[[HANDOFF:<reason>]]`, e.g. "lima"/"provincia")
      // additionally notifies that event's own destinations (migration 049).
      await sendNeedsReplyTelegramAlert(db, {
        accountId,
        conversationId,
        contactId,
        reason: 'handoff',
        detail: summary,
        handoffReason,
      })

      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    const sendText = () =>
      engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text,
        aiGenerated: true,
      })

    // Which image (if any) to attach: ONLY the model's own explicit
    // `[[IMAGE:<key>]]` pick — never the RAG top-matched-document image
    // as a fallback. That fallback sounds reasonable (right category
    // even without a sentinel) but in practice it's a coarse guess off
    // whatever chunk best matched the latest turns, and a short
    // follow-up reply (the model answering a quick question without
    // re-emitting the sentinel) can retrieve a completely unrelated
    // document — better to send no image than the wrong one.
    const resolvedImageUrl = imageKey ? await getProductImage(db, accountId, imageKey) : null

    // Product photo: providers are text-only, so this is the only way a
    // picture reaches the customer without a human. Sent as ONE message
    // — the image with the reply as its caption — rather than two, so
    // the recommendation and the photo land together. Meta caps image
    // captions at 1024 chars; on the rare reply that runs longer, skip
    // the image rather than risk the send failing outright.
    if (resolvedImageUrl && text.length <= 1024) {
      try {
        await engineSendMedia({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          kind: 'image',
          link: resolvedImageUrl,
          caption: text,
          aiGenerated: true,
        })
      } catch (err) {
        console.error(
          '[ai auto-reply] image+caption send failed, falling back to text-only:',
          err,
        )
        await sendText()
      }
    } else {
      await sendText()
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
