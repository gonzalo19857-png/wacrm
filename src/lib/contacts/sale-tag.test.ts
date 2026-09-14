import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSaleDeal } from './sale-tag'

interface CapturedInsert {
  table: string
  row: Record<string, unknown>
}

function fakeDb(opts: {
  contact?: { name: string | null; phone: string } | null
  pipeline?: { id: string } | null
  stage?: { id: string } | null
  captured: CapturedInsert[]
}): SupabaseClient {
  const { contact = null, pipeline = null, stage = null, captured } = opts
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === 'contacts') return { data: contact, error: null }
          if (table === 'pipelines') return { data: pipeline, error: null }
          if (table === 'pipeline_stages') return { data: stage, error: null }
          return { data: null, error: null }
        },
        insert: (row: Record<string, unknown>) => {
          captured.push({ table, row })
          return {
            select: () => ({
              single: async () => ({ data: { id: 'deal-new' }, error: null }),
            }),
          }
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe('createSaleDeal', () => {
  it('drops the deal into the account\'s first pipeline + first stage', async () => {
    const captured: CapturedInsert[] = []
    const db = fakeDb({
      contact: { name: 'Willy Aquino', phone: '51994904818' },
      pipeline: { id: 'pipe-1' },
      stage: { id: 'stage-1' },
      captured,
    })

    const deal = await createSaleDeal(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 110,
      currency: 'PEN',
    })

    expect(deal).toEqual({ id: 'deal-new' })
    expect(captured).toHaveLength(1)
    expect(captured[0].table).toBe('deals')
    expect(captured[0].row).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      pipeline_id: 'pipe-1',
      stage_id: 'stage-1',
      contact_id: 'contact-1',
      title: 'Venta — Willy Aquino',
      value: 110,
      currency: 'PEN',
      status: 'open',
    })
  })

  it('falls back to the phone for the title when the contact has no name', async () => {
    const captured: CapturedInsert[] = []
    const db = fakeDb({
      contact: { name: null, phone: '51994904818' },
      pipeline: { id: 'pipe-1' },
      stage: { id: 'stage-1' },
      captured,
    })

    await createSaleDeal(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 50,
      currency: 'USD',
    })

    expect(captured[0].row.title).toBe('Venta — 51994904818')
  })

  it('returns null without inserting when the account has no pipeline', async () => {
    const captured: CapturedInsert[] = []
    const db = fakeDb({ pipeline: null, captured })

    const deal = await createSaleDeal(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 50,
      currency: 'USD',
    })

    expect(deal).toBeNull()
    expect(captured).toHaveLength(0)
  })

  it('returns null without inserting when the pipeline has no stages', async () => {
    const captured: CapturedInsert[] = []
    const db = fakeDb({ pipeline: { id: 'pipe-1' }, stage: null, captured })

    const deal = await createSaleDeal(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 50,
      currency: 'USD',
    })

    expect(deal).toBeNull()
    expect(captured).toHaveLength(0)
  })
})
