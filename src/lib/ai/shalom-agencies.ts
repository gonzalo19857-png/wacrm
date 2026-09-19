import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { latestUserMessage } from './query'

export interface ShalomAgencyOption {
  name: string
  address: string
  reference: string | null
}

export interface ShalomCityMatch {
  city: string
  options: ShalomAgencyOption[]
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find the first known city named as a whole word in `text` — pure so
 * it's unit-testable without a DB. Longer city names are checked
 * first so e.g. "Huancayo" doesn't shadow a hypothetical shorter city
 * whose name it happens to contain.
 */
export function matchCityInText(text: string, cities: string[]): string | null {
  const normText = normalize(text)
  if (!normText) return null
  const sorted = [...cities].sort((a, b) => b.length - a.length)
  for (const city of sorted) {
    const normCity = normalize(city)
    if (!normCity) continue
    const re = new RegExp(`\\b${escapeRegExp(normCity)}\\b`)
    if (re.test(normText)) return city
  }
  return null
}

/**
 * Look up the account's real Shalom agencies for whichever city the
 * customer just named, if any (migration 052). Deliberately reads
 * from this table — admin-entered, business-verified data — rather
 * than anything the model itself might "know" about Shalom's branch
 * network: agency listings change, and a wrong address sent
 * automatically is worse than the manual screenshot it replaces. No
 * match (city not mentioned, or not yet in the table) returns null —
 * the account's own prompt falls back to the existing
 * `[[HANDOFF:provincia]]` so a human handles it exactly as before.
 */
export async function findShalomAgenciesForMessages(
  db: SupabaseClient,
  accountId: string,
  messages: ChatMessage[],
): Promise<ShalomCityMatch | null> {
  try {
    const { data, error } = await db
      .from('shalom_agencies')
      .select('city, name, address, reference')
      .eq('account_id', accountId)
      .eq('is_active', true)
    if (error || !data || data.length === 0) return null

    const rows = data as { city: string; name: string; address: string; reference: string | null }[]
    const cities = Array.from(new Set(rows.map((r) => r.city)))
    const text = latestUserMessage(messages, 3)
    const matchedCity = matchCityInText(text, cities)
    if (!matchedCity) return null

    const options = rows
      .filter((r) => r.city === matchedCity)
      .map((r) => ({ name: r.name, address: r.address, reference: r.reference }))
    if (options.length === 0) return null

    return { city: matchedCity, options }
  } catch (err) {
    console.error('[shalom agencies] lookup failed:', err)
    return null
  }
}
