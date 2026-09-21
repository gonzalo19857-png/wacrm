/**
 * Image generation for Studio's media picker — lets the owner generate
 * a photo for a post instead of only picking from the product catalog
 * or uploading their own.
 *
 * Routed through OpenRouter (not Google's Gemini API directly) because
 * the account's key is an OpenRouter key — same BYO-key model as the
 * chat providers in src/lib/ai/providers/, and the SAME endpoint
 * (`/api/v1/chat/completions`) as `generateOpenRouter`, just with
 * `modalities: ["image", "text"]` requested so the model returns an
 * image instead of (or alongside) text. OpenRouter has no separate
 * "images" endpoint — an earlier attempt at one 404'd.
 */

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

// "Nano Banana Pro" on OpenRouter.
const IMAGE_MODEL = 'google/gemini-3-pro-image-preview'

interface OpenRouterChatResponse {
  choices?: {
    message?: {
      content?: string | null
      images?: { image_url?: { url?: string } }[]
    }
  }[]
  error?: { message?: string }
}

/**
 * The picker's prompt box is filled by default with the post's `idea`
 * (sometimes a full draft caption with hashtags, not an image
 * description) — sent as-is, the model tends to reply with MORE copy
 * instead of a picture. Wrapping it as an explicit image instruction
 * keeps the owner's words as the subject while steering the model to
 * actually render a photo.
 */
function buildImagePrompt(userPrompt: string): string {
  return (
    'Generate a single photorealistic marketing photo — no rendered text, ' +
    'no logos, no captions burned into the image itself — depicting: ' +
    `${userPrompt}\n\nRespond with the image only, not a written post or caption.`
  )
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/**
 * Reference photos are the account's own previously-approved generated
 * images (studio_brand_references, fed in by the caller) — shown to the
 * model before the actual request so it matches lighting/color
 * grading/composition instead of generating a generic result each time.
 */
function buildContent(prompt: string, referenceImages: string[]): ChatContentPart[] {
  const content: ChatContentPart[] = []
  if (referenceImages.length > 0) {
    content.push({
      type: 'text',
      text:
        'The photos below are previously approved marketing photos for this brand. ' +
        'Match their visual style — lighting, color grading, composition, mood — as ' +
        'closely as makes sense while generating the new photo described after them.',
    })
    for (const url of referenceImages) {
      content.push({ type: 'image_url', image_url: { url } })
    }
  }
  content.push({ type: 'text', text: buildImagePrompt(prompt) })
  return content
}

export async function generateImage(args: {
  apiKey: string
  prompt: string
  /** Public URLs of the account's approved reference photos, most recent first. */
  referenceImages?: string[]
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const { apiKey, prompt, referenceImages = [] } = args

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: 'user', content: buildContent(prompt, referenceImages) }],
      modalities: ['image', 'text'],
    }),
  })

  const rawText = await response.text()
  let data: OpenRouterChatResponse | null = null
  try {
    data = JSON.parse(rawText)
  } catch {
    data = null
  }

  if (!response.ok) {
    console.error('[gemini-image] OpenRouter error response:', response.status, rawText)
    const message =
      data?.error?.message ?? `OpenRouter image generation failed: ${response.status} — ${rawText.slice(0, 300)}`
    throw new Error(message)
  }

  // Images come back as a data: URL, e.g. "data:image/png;base64,AAAA...".
  const dataUrl = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!dataUrl) {
    console.error('[gemini-image] unexpected success response shape:', rawText.slice(0, 500))
    const textReply = data?.choices?.[0]?.message?.content?.trim()
    throw new Error(
      textReply
        ? `El modelo respondió con texto en vez de una imagen: "${textReply.slice(0, 150)}${textReply.length > 150 ? '…' : ''}". Prueba describiendo la foto de forma más simple (ej. "foto de un cobertor de moto azul sobre una moto deportiva").`
        : 'OpenRouter no devolvió ninguna imagen.',
    )
  }
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('OpenRouter devolvió una imagen en un formato inesperado.')
  }
  const [, mimeType, base64] = match
  return { bytes: Buffer.from(base64, 'base64'), mimeType }
}
