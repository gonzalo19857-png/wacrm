import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSale } from './sale-tag'

interface CapturedInsert {
  table: string
  row: Record<string, unknown>
}

function fakeDb(opts: {
  contact?: { name: string | null; phone: string } | null
  captured: CapturedInsert[]
  insertError?: { message: string } | null
}): SupabaseClient {
  const { contact = null, captured, insertError = null } = opts
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => {
          if (table === 'contacts') return { data: contact, error: null }
          return { data: null, error: null }
        },
        insert: (row: Record<string, unknown>) => {
          captured.push({ table, row })
          return {
            select: () => ({
              single: async () =>
                insertError
                  ? { data: null, error: insertError }
                  : { data: { id: 'sale-new' }, error: null },
            }),
          }
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

describe('createSale', () => {
  it('inserts a sale row for the contact', async () => {
    const captured: CapturedInsert[] = []
    const db = fakeDb({
      contact: { name: 'Willy Aquino', phone: '51994904818' },
      captured,
    })

    const sale = await createSale(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 110,
      currency: 'PEN',
    })

    expect(sale).toEqual({ id: 'sale-new', modelo: 'UNFOUND' })
    expect(captured).toHaveLength(1)
    expect(captured[0].table).toBe('sales')
    expect(captured[0].row).toMatchObject({
      account_id: 'acct-1',
      user_id: 'user-1',
      contact_id: 'contact-1',
      title: 'Venta — Willy Aquino',
      value: 110,
      currency: 'PEN',
    })
  })

  it('falls back to the phone for the title when the contact has no name', async () => {
    const captured: CapturedInsert[] = []
    const db = fakeDb({
      contact: { name: null, phone: '51994904818' },
      captured,
    })

    await createSale(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 50,
      currency: 'USD',
    })

    expect(captured[0].row.title).toBe('Venta — 51994904818')
  })

  it('returns null when the insert fails', async () => {
    const captured: CapturedInsert[] = []
    const db = fakeDb({ captured, insertError: { message: 'boom' } })

    const sale = await createSale(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      tagName: 'Venta',
      price: 50,
      currency: 'USD',
    })

    expect(sale).toBeNull()
  })
})
