import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const ACCOUNT_ID = '10c19410-3975-48d9-9bc5-0eb16fca08d7'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await db
  .from('ai_configs')
  .select('system_prompt')
  .eq('account_id', ACCOUNT_ID)
  .maybeSingle()

if (error) { console.error(error); process.exit(1) }

const OLD = '🕙 Turno mañana: 10:00 am – 12:00 pm\n🕑 Turno tarde: 2:00 pm – 4:00 pm\n🌆 Turno noche: 5:00 pm – 8:00 pm'
const NEW = '🕙 Turno mañana: 10:00 am – 12:00 pm\n🕑 Turno tarde: 2:00 pm – 5:00 pm\n🌆 Turno noche: 6:00 pm – 8:00 pm'

const current = data.system_prompt
if (!current.includes(OLD)) {
  console.error('OLD block not found verbatim in production system_prompt — aborting without writing.')
  process.exit(1)
}

const updated = current.replace(OLD, NEW)

const { error: updateError } = await db
  .from('ai_configs')
  .update({ system_prompt: updated })
  .eq('account_id', ACCOUNT_ID)

if (updateError) { console.error(updateError); process.exit(1) }
console.log('OK — turno hours updated in production system_prompt.')
console.log('New length:', updated.length, '(was', current.length, ')')
