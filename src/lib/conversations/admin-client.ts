import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the conversations helpers.
// Mirrors src/lib/ai/admin-client.ts, src/lib/flows/admin-client.ts,
// src/lib/automations/admin-client.ts — inbound webhooks have no
// `auth.uid()`, so this path reads/writes through the service role.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
