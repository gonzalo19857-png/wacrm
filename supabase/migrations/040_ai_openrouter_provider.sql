-- ============================================================
-- 040_ai_openrouter_provider.sql — allow "openrouter" as an AI provider
--
-- Adds OpenRouter as a third bring-your-own-key option alongside OpenAI
-- and Anthropic. OpenRouter exposes an OpenAI-compatible Chat
-- Completions endpoint that fronts many upstream models, so the app
-- talks to it as a normal provider adapter — this migration only widens
-- the two CHECK constraints that previously allow-listed
-- 'openai' | 'anthropic'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'openrouter'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'openrouter'));
