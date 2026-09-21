import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { generateImage } from '@/lib/studio/gemini-image'
import { getRecentBrandReferences } from '@/lib/studio/brand-references'

/**
 * POST /api/studio/media/generate-image  (agent+)
 * Body: { prompt: string }
 * Generates an image with the account's own Gemini key
 * (studio_ai_settings), uploads it to the studio-media bucket, and
 * returns its public URL — same shape media-picker.tsx already
 * expects from a manual upload.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`studio-image-generate:${userId}`, RATE_LIMITS.studioImageGenerate)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required.' }, { status: 400 })
    }

    const { data: settings, error: settingsError } = await supabase
      .from('studio_ai_settings')
      .select('gemini_api_key')
      .eq('account_id', accountId)
      .maybeSingle()
    if (settingsError) throw settingsError
    if (!settings) {
      return NextResponse.json(
        {
          error: 'No has configurado tu clave de Gemini todavía.',
          code: 'gemini_not_configured',
        },
        { status: 400 },
      )
    }

    const referenceImages = await getRecentBrandReferences(supabase, accountId)

    let bytes: Buffer
    let mimeType: string
    try {
      const apiKey = decrypt(settings.gemini_api_key)
      ;({ bytes, mimeType } = await generateImage({ apiKey, prompt, referenceImages }))
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'No se pudo generar la imagen.' },
        { status: 502 },
      )
    }

    const ext = mimeType === 'image/png' ? 'png' : 'jpg'
    const path = `${accountId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('studio-media')
      .upload(path, bytes, { contentType: mimeType, upsert: false })
    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = supabase.storage.from('studio-media').getPublicUrl(path)

    return NextResponse.json({ url: publicUrl, referenceCount: referenceImages.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}
