import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
}))

import { resolveAdCampaignLine } from './ad-campaign'

function makeDb(token: string | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: token ? { long_lived_user_token: token } : null,
              error: null,
            }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('resolveAdCampaignLine', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('classifies a campaign named with LED-line keywords as led', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ campaign: { id: 'camp-1', name: 'Focos LED general' } }),
      }),
    )
    const result = await resolveAdCampaignLine(makeDb('token'), 'acct-1', 'ad-1')
    expect(result).toEqual({ campaignId: 'camp-1', productLine: 'led' })
  })

  it('classifies a campaign with no LED-line keyword as cobertor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ campaign: { id: 'camp-2', name: 'Cobertores - Lima' } }),
      }),
    )
    const result = await resolveAdCampaignLine(makeDb('token'), 'acct-1', 'ad-2')
    expect(result).toEqual({ campaignId: 'camp-2', productLine: 'cobertor' })
  })

  it('returns null when the account has no Studio Meta connection configured', async () => {
    const result = await resolveAdCampaignLine(makeDb(null), 'acct-1', 'ad-1')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null when the Graph API call fails, instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))
    const result = await resolveAdCampaignLine(makeDb('token'), 'acct-1', 'ad-1')
    expect(result).toBeNull()
  })

  it('returns null when the response has no campaign (e.g. an organic post, not an ad)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    )
    const result = await resolveAdCampaignLine(makeDb('token'), 'acct-1', 'post-1')
    expect(result).toBeNull()
  })
})
