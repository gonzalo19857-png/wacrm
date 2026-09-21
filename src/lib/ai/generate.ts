import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  HANDOFF_SENTINEL_REGEX,
  IMAGE_SENTINEL_REGEX,
  NOREPLY_SENTINEL,
  POTENCIAL_SENTINEL_REGEX,
  SHIPMENT_SENTINEL_REGEX,
  aiRequestTimeoutMs,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateOpenRouter } from './providers/openrouter'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'openrouter':
      result = await generateOpenRouter(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into
 * `{ text, handoff, noReply, imageKey, usage }`. The handoff and
 * no-reply sentinels can appear alone or trailing a partial reply;
 * either way we treat the turn accordingly and strip the marker from
 * any remaining text. The image sentinel (if present) is extracted and
 * stripped the same way — it's addressed to the code, never shown to
 * the customer. `usage` is passed straight through (null when the
 * provider didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoffMatch = raw.match(HANDOFF_SENTINEL_REGEX)
  const handoff = !!handoffMatch
  const handoffReason = handoffMatch?.[1]?.toLowerCase() ?? null
  const noReply = raw.includes(NOREPLY_SENTINEL)
  const imageMatch = raw.match(IMAGE_SENTINEL_REGEX)
  const imageKey = imageMatch ? imageMatch[1].trim() : null
  const shipmentMatch = raw.match(SHIPMENT_SENTINEL_REGEX)
  const shipmentRaw = shipmentMatch ? shipmentMatch[1].trim() : null
  const reachedPaymentInfo = POTENCIAL_SENTINEL_REGEX.test(raw)
  // Strip every occurrence, not just the first: neither regex has a /g
  // flag (match() with one wouldn't give us the capture groups above),
  // but a non-global replace() only removes the first match — if the
  // model ever emits a tag more than once, the rest leak into the
  // customer-visible text. Build fresh global copies for the strip so
  // the extraction regexes above are unaffected.
  const handoffSentinelGlobal = new RegExp(HANDOFF_SENTINEL_REGEX.source, 'g')
  const imageSentinelGlobal = new RegExp(IMAGE_SENTINEL_REGEX.source, 'g')
  const shipmentSentinelGlobal = new RegExp(SHIPMENT_SENTINEL_REGEX.source, 'g')
  const potencialSentinelGlobal = new RegExp(POTENCIAL_SENTINEL_REGEX.source, 'g')
  const text = raw
    .replace(handoffSentinelGlobal, '')
    .split(NOREPLY_SENTINEL)
    .join('')
    .replace(imageSentinelGlobal, '')
    .replace(shipmentSentinelGlobal, '')
    .replace(potencialSentinelGlobal, '')
    .trim()
  return {
    text,
    handoff,
    handoffReason,
    noReply,
    imageKey,
    shipmentRaw,
    reachedPaymentInfo,
    usage,
  }
}
