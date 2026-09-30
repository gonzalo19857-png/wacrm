// Ingests the extracted LED catalog (local/led/catalog.seed.json) into the
// AI knowledge base (ai_knowledge_documents + ai_knowledge_chunks) for the
// GMVA Auto account, one document per product family. Mirrors the real
// ingest path (src/lib/ai/knowledge.ts ingestDocument): chunk, embed when an
// embeddings key is configured, insert. Idempotent — replaces any existing
// document with the same title (and its chunks) instead of duplicating.
import 'dotenv/config'
import crypto from 'crypto'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const ACCOUNT_ID = '10c19410-3975-48d9-9bc5-0eb16fca08d7' // Gonzalo Loayza / GMVA Auto

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

// ---- decrypt() copied from src/lib/whatsapp/encryption.ts (GCM path) ----
function decrypt(encryptedText) {
  const parts = encryptedText.split(':')
  if (parts.length !== 3) throw new Error('expected GCM ciphertext (3 parts)')
  const [ivHex, ctHex, tagHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(tagHex, 'hex')
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
    iv,
  )
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(ctHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// ---- chunkText() copied verbatim from src/lib/ai/chunk.ts ----
function chunkText(content, opts = {}) {
  const maxChars = opts.maxChars ?? 1200
  const text = content.replace(/\r\n/g, '\n').trim()
  if (!text) return []
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let current = ''
  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush()
      for (let i = 0; i < para.length; i += maxChars) {
        const slice = para.slice(i, i + maxChars).trim()
        if (slice) chunks.push(slice)
      }
      continue
    }
    if (current && current.length + 2 + para.length > maxChars) flush()
    current = current ? `${current}\n\n${para}` : para
  }
  flush()
  return chunks
}

// ---- embedTexts() copied (trimmed) from src/lib/ai/embeddings.ts ----
const EMBEDDING_MODEL = 'text-embedding-3-small'
const BATCH_SIZE = 96
function toVectorLiteral(embedding) {
  return `[${embedding.join(',')}]`
}
async function embedTexts(apiKey, inputs) {
  if (inputs.length === 0) return []
  const out = []
  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    })
    if (!res.ok) {
      throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`)
    }
    const data = await res.json()
    const ordered = [...data.data].sort((a, b) => a.index - b.index)
    for (const r of ordered) out.push(r.embedding)
  }
  return out
}

// ---- build one knowledge-doc content string per family ----
function money(p) {
  if (p.priceStatus !== 'catalogue' || p.pricePEN == null) return 'Precio a confirmar con el proveedor'
  return `S/ ${p.pricePEN.toFixed(2)}`
}

function productBlock(p) {
  const lines = []
  const code = p.model ? `[${p.model}] ` : ''
  lines.push(`${code}${p.name} — ${money(p)}`)
  for (const f of p.facts) lines.push(`- ${f}`)
  if (p.saleUnit) lines.push(`- Unidad de venta: ${p.saleUnit}`)
  for (const note of p.reviewNotes) lines.push(`- Nota: ${note}`)
  return lines.join('\n')
}

function familyContent(family, products) {
  const intro =
    `Catálogo GMVA Auto — línea "${family}" (catálogo Setiembre 2026, datos de julio conservados donde no hubo cambio). ` +
    `Los precios son de catálogo, no una oferta comercial vigente confirmada, y el stock no está confirmado — antes de asegurarle a un cliente un precio o disponibilidad exacta, o si el producto que pide no aparece claramente en esta lista, prefiere derivar a un asesor humano en vez de inventar o adivinar. ` +
    `Cada producto aquí abajo muestra su código entre corchetes cuando lo tiene, nombre, precio y especificaciones tal como figuran en el catálogo.`
  const blocks = products.map(productBlock)
  return [intro, ...blocks].join('\n\n')
}

async function upsertDocument(title, content, embeddingsApiKey) {
  // Idempotent: delete any prior document with this title for this
  // account (chunks cascade), then insert fresh — same replace-not-append
  // idiom as ingestDocument().
  const { data: existing } = await db
    .from('ai_knowledge_documents')
    .select('id')
    .eq('account_id', ACCOUNT_ID)
    .eq('title', title)
  for (const row of existing ?? []) {
    await db.from('ai_knowledge_documents').delete().eq('id', row.id)
  }

  const { data: doc, error } = await db
    .from('ai_knowledge_documents')
    .insert({ account_id: ACCOUNT_ID, title, content })
    .select('id')
    .single()
  if (error) throw error

  const chunks = chunkText(content)
  if (chunks.length === 0) return { id: doc.id, chunks: 0, embedded: false }

  let embeddings = null
  if (embeddingsApiKey) {
    embeddings = await embedTexts(embeddingsApiKey, chunks)
  }

  const rows = chunks.map((content, i) => ({
    document_id: doc.id,
    account_id: ACCOUNT_ID,
    chunk_index: i,
    content,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }))
  const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
  if (insErr) throw insErr

  return { id: doc.id, chunks: rows.length, embedded: !!embeddings }
}

async function main() {
  const catalog = JSON.parse(readFileSync('local/led/catalog.seed.json', 'utf8'))
  const products = catalog.products.filter((p) => p.enabled)

  const { data: cfg } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', ACCOUNT_ID)
    .maybeSingle()
  const embeddingsApiKey = cfg?.embeddings_api_key ? decrypt(cfg.embeddings_api_key) : null
  console.log('Embeddings key present:', !!embeddingsApiKey)

  const byFamily = new Map()
  for (const p of products) {
    if (!byFamily.has(p.family)) byFamily.set(p.family, [])
    byFamily.get(p.family).push(p)
  }

  for (const [family, items] of byFamily) {
    const title = `LED — ${family}`
    const content = familyContent(family, items)
    const result = await upsertDocument(title, content, embeddingsApiKey)
    console.log(
      `${title}: ${items.length} productos, ${result.chunks} chunks, embedded=${result.embedded}, doc=${result.id}`,
    )
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
