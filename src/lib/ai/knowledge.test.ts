import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import { retrieveKnowledge, retrieveKnowledgeForMessages, ingestDocument } from './knowledge'

interface FakeState {
  semantic: { id: string; content: string; document_id?: string }[]
  fts: { id: string; content: string; document_id?: string }[]
  chunkCount: number
  rpcCalls: string[]
  inserted: Record<string, unknown>[] | null
  deletedFor: string | null
  /** document_id → image_url, consulted for the top-ranked match. */
  images: Record<string, string | null>
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    inserted: null,
    deletedFor: null,
    images: {},
  }
  const db = {
    rpc: (name: string) => {
      state.rpcCalls.push(name)
      if (name === 'match_ai_knowledge_semantic')
        return Promise.resolve({ data: state.semantic, error: null })
      if (name === 'match_ai_knowledge_fts')
        return Promise.resolve({ data: state.fts, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      if (table === 'ai_knowledge_documents') {
        return {
          select: () => ({
            eq: (_col: string, docId: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { image_url: state.images[docId] ?? null },
                  error: null,
                }),
            }),
          }),
        }
      }
      return {
        // retrieveKnowledge's empty-KB count guard.
        select: () => ({
          eq: () => Promise.resolve({ count: state.chunkCount, error: null }),
        }),
        delete: () => ({
          eq: (_col: string, val: string) => {
            state.deletedFor = val
            return Promise.resolve({ error: null })
          },
        }),
        insert: (rows: Record<string, unknown>[]) => {
          state.inserted = rows
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, state }
}

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i]),
  )
})

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb()
    expect(
      await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  '),
    ).toEqual({ excerpts: [], imageUrl: null })
    expect(state.rpcCalls).toEqual([])
  })

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out).toEqual({ excerpts: [], imageUrl: null })
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
  })

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1', document_id: 'doc-f1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual({ excerpts: ['F1'], imageUrl: null })
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1', document_id: 'doc-s1' },
      { id: 's2', content: 'S2', document_id: 'doc-s2' },
      { id: 's3', content: 'S3', document_id: 'doc-s3' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual({ excerpts: ['S1', 'S2', 'S3'], imageUrl: null })
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic'])
  })

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1', document_id: 'doc-s1' },
      { id: 's2', content: 'S2', document_id: 'doc-s2' },
    ]
    state.fts = [
      { id: 's2', content: 'S2-dup', document_id: 'doc-s2' }, // dedup by id
      { id: 'f1', content: 'F1', document_id: 'doc-f1' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual({ excerpts: ['S1', 'S2', 'F1'], imageUrl: null })
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ])
  })

  it('resolves the top-ranked match\'s document image', async () => {
    const { db, state } = makeDb()
    state.semantic = [{ id: 's1', content: 'S1', document_id: 'doc-s1' }]
    state.images['doc-s1'] = 'https://example.com/suv.jpg'
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out).toEqual({
      excerpts: ['S1'],
      imageUrl: 'https://example.com/suv.jpg',
    })
  })

  it('leaves imageUrl null when the top document has none set', async () => {
    const { db, state } = makeDb()
    state.semantic = [{ id: 's1', content: 'S1', document_id: 'doc-s1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out.imageUrl).toBeNull()
  })
})

describe('retrieveKnowledgeForMessages', () => {
  // A query-aware db: FTS results depend on which candidate query was
  // sent, so the fallback-to-widened-window behavior is observable.
  function makeQueryAwareDb(byQuery: Record<string, { id: string; content: string; document_id: string }[]>) {
    return {
      from: () => ({
        select: () => ({ eq: () => Promise.resolve({ count: 1, error: null }) }),
      }),
      rpc: (name: string, args: { p_query: string }) => {
        if (name === 'match_ai_knowledge_fts') {
          return Promise.resolve({ data: byQuery[args.p_query] ?? [], error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
    } as unknown as SupabaseClient
  }

  it('uses the latest-turn result when it finds something', async () => {
    const db = makeQueryAwareDb({
      'Toyota Yaris 2019': [{ id: 'c1', content: 'Sedán match', document_id: 'doc-sedan' }],
    })
    const messages = [
      { role: 'user' as const, content: 'Hyundai Tucson' },
      { role: 'user' as const, content: 'Toyota Yaris 2019' },
    ]
    const out = await retrieveKnowledgeForMessages(db, 'acct', { embeddingsApiKey: null }, messages)
    expect(out.excerpts).toEqual(['Sedán match'])
  })

  it('falls back to the widened window when the latest turn alone finds nothing', async () => {
    const db = makeQueryAwareDb({
      'Hyundai Tucson\nAlguna imagen?': [{ id: 'c1', content: 'SUV match', document_id: 'doc-suv' }],
    })
    const messages = [
      { role: 'user' as const, content: 'Hyundai Tucson' },
      { role: 'user' as const, content: 'Alguna imagen?' },
    ]
    const out = await retrieveKnowledgeForMessages(db, 'acct', { embeddingsApiKey: null }, messages)
    expect(out.excerpts).toEqual(['SUV match'])
  })

  it('returns empty when neither candidate finds anything', async () => {
    const db = makeQueryAwareDb({})
    const messages = [{ role: 'user' as const, content: 'hola' }]
    const out = await retrieveKnowledgeForMessages(db, 'acct', { embeddingsApiKey: null }, messages)
    expect(out).toEqual({ excerpts: [], imageUrl: null })
  })
})

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBe('[0,0]') // literal from mocked embed
    expect(state.inserted![0].account_id).toBe('acct')
  })

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', '   ')
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toBeNull()
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'))
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world'),
    ).rejects.toThrow('rate limited')
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBeNull()
  })
})
