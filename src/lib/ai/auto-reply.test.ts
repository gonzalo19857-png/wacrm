import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
  getProductImage: vi.fn(),
  sendNeedsReplyTelegramAlert: vi.fn(),
  quoteLastCustomerMessage: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    // When set, the SECOND+ conversations select (the debounce recheck)
    // returns this instead of `conv` — lets a test simulate a newer
    // inbound message landing during the debounce wait.
    convOnRecheck: null as Record<string, unknown> | null,
    convSelectCount: 0,
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledgeForMessages: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./product-images', () => ({ getProductImage: h.getProductImage }))
vi.mock('./handoff', async (importOriginal) => ({
  // buildHandoffSummary stays real — the handoff tests below assert on
  // its actual output. Only the two Telegram-notify exports are
  // stubbed, so no test makes a real network call.
  ...(await importOriginal<Record<string, unknown>>()),
  sendNeedsReplyTelegramAlert: h.sendNeedsReplyTelegramAlert,
  quoteLastCustomerMessage: h.quoteLastCustomerMessage,
}))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              h.state.convSelectCount += 1
              const data =
                h.state.convSelectCount > 1 && h.state.convOnRecheck !== null
                  ? h.state.convOnRecheck
                  : h.state.conv
              return Promise.resolve({ data, error: null })
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    last_message_at: '2026-01-01T00:00:00Z',
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.convOnRecheck = null
  h.state.convSelectCount = 0
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue({ excerpts: [], imageUrl: null })
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false, imageKey: null })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'm2' })
  h.getProductImage.mockResolvedValue(null)
  h.sendNeedsReplyTelegramAlert.mockClear()
  h.quoteLastCustomerMessage.mockReset()
  h.quoteLastCustomerMessage.mockResolvedValue('Último mensaje: "hola"')
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue({
      excerpts: ['Returns accepted within 30 days.'],
      imageUrl: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('sends the reply as an image with the text as its caption when the model picks one', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Talla L',
      handoff: false,
      imageKey: 'suv-l',
    })
    h.getProductImage.mockResolvedValue('https://example.com/suv-l.jpg')
    await dispatchInboundToAiReply(ARGS)
    expect(h.getProductImage).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'suv-l')
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        kind: 'image',
        link: 'https://example.com/suv-l.jpg',
        caption: '*talla L*',
      }),
    )
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('sends plain text when the model names no image key', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('sends text-only — never a RAG-guessed image — when the sentinel key has no configured match', async () => {
    // Retrieval matched a document with its own image (a different,
    // coarser signal than the model's own pick); that image must never
    // be used as a fallback — see resolvedImageUrl in auto-reply.ts.
    h.retrieveKnowledge.mockResolvedValue({
      excerpts: ['SUV cover.'],
      imageUrl: 'https://example.com/suv-m.jpg',
    })
    h.generateReply.mockResolvedValue({
      text: 'Talla L',
      handoff: false,
      imageKey: 'suv-l',
    })
    h.getProductImage.mockResolvedValue(null) // key not configured for this account
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*talla L*' }),
    )
  })

  it('falls back to a text-only send when the caption exceeds 1024 chars', async () => {
    h.generateReply.mockResolvedValue({
      text: 'x'.repeat(1025),
      handoff: false,
      imageKey: 'suv-l',
    })
    h.getProductImage.mockResolvedValue('https://example.com/suv-l.jpg')
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('a failed image send falls back to a text-only send', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Talla L',
      handoff: false,
      imageKey: 'suv-l',
    })
    h.getProductImage.mockResolvedValue('https://example.com/suv-l.jpg')
    h.engineSendMedia.mockRejectedValue(new Error('meta down'))
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('dispatchInboundToAiReply — no-reply', () => {
  it('sends nothing and leaves the conversation untouched on [[NOREPLY]]', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: false, noReply: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    // Unlike a handoff: no reply slot claimed, no conversation update —
    // the bot stays fully active for the customer's next message.
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toBeNull()
  })

  it('does NOT alert Telegram — the bot deliberately chose silence, nobody needs to jump in', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: false, noReply: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendNeedsReplyTelegramAlert).not.toHaveBeenCalled()
  })
})

// ============================================================
// "Needs a human" Telegram alerts (migration 049: whether anything
// actually sends depends on the account's `telegram_destinations`
// rows, which is `notifyTelegramDestinations`'s concern, not this
// layer's — here we only assert `sendNeedsReplyTelegramAlert` is
// called, with `accountId` so it can look those rows up, on every gate
// that used to sit silent: a follow-up message on an already-handed-
// off thread, a thread a human already owns, or one that hit the reply
// cap. That silence is exactly what made the feature unreliable
// ("avísame cuando haya que responder manualmente").
// ============================================================
describe('dispatchInboundToAiReply — needs-human Telegram alerts', () => {
  it('alerts when a human agent already owns the thread', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendNeedsReplyTelegramAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: ARGS.accountId,
        conversationId: ARGS.conversationId,
        contactId: ARGS.contactId,
        reason: 'needs_human',
        detail: 'Último mensaje: "hola"',
      }),
    )
  })

  it('alerts on a follow-up message on an already-handed-off thread', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 1,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendNeedsReplyTelegramAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'needs_human' }),
    )
  })

  it('alerts when the per-conversation reply cap is reached', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyMaxPerConversation: 3 }))
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendNeedsReplyTelegramAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'needs_human' }),
    )
  })

  it('alerts with the AI handoff summary (not the generic quote) on a fresh handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendNeedsReplyTelegramAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: 'handoff',
        detail: expect.stringContaining('AI agent handed off'),
      }),
    )
    // The generic last-message quote is only for gates that never build
    // conversation context — a fresh handoff already has a real summary.
    expect(h.quoteLastCustomerMessage).not.toHaveBeenCalled()
  })

  it('passes through an optional handoff reason tag (e.g. "lima") for a region-specific destination', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, handoffReason: 'lima' })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendNeedsReplyTelegramAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'handoff', handoffReason: 'lima' }),
    )
  })
})

describe('dispatchInboundToAiReply — debounce', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('still replies when no newer inbound message lands during the debounce wait', async () => {
    vi.stubEnv('AI_DEBOUNCE_MS', '5')
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('bails without replying when a newer inbound message lands during the wait — a later invocation owns the whole burst', async () => {
    vi.stubEnv('AI_DEBOUNCE_MS', '5')
    h.state.convOnRecheck = { ...h.state.conv, last_message_at: '2026-01-01T00:00:05Z' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })
})
