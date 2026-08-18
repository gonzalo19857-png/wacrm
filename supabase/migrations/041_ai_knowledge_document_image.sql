-- ============================================================
-- 041_ai_knowledge_document_image.sql
--
-- Lets a knowledge-base document carry one product image. When that
-- document is the top-ranked grounding for an auto-reply, the bot
-- attaches the image alongside its text reply (auto-reply.ts) — the
-- provider adapters are text-only, so this is how the bot can show a
-- customer a product photo without a human relaying it.
--
-- The retrieval RPCs (migration 030) only returned `id`/`content`, with
-- no way to trace a matched chunk back to its parent document. Both are
-- recreated here to also return `document_id` so the caller can look up
-- that document's `image_url`. Postgres requires DROP + CREATE (not
-- CREATE OR REPLACE) when a function's return columns change.
--
-- Also fixes a latent bug in the lexical path: `plainto_tsquery` ANDs
-- every word of the input together, so it only matches a chunk that
-- contains ALL of them. A real customer message ("Nissan Kicks 2019")
-- almost never fully overlaps a knowledge chunk's wording (chunks don't
-- quote arbitrary years, greetings, etc.), so lexical retrieval was
-- silently returning zero rows for most natural-language queries.
-- Rewritten to OR the terms instead — any overlapping word surfaces the
-- chunk, ranked by how many terms actually matched.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS image_url text;

DROP FUNCTION IF EXISTS public.match_ai_knowledge_fts(uuid, text, integer);
CREATE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, document_id uuid, rank real) AS $$
  WITH q AS (
    -- OR the AND-query's terms together (see note above) so any single
    -- overlapping word surfaces the chunk; ts_rank still favors chunks
    -- that match more of them.
    SELECT to_tsquery(
      'simple',
      NULLIF(regexp_replace(plainto_tsquery('simple', p_query)::text, ' & ', ' | ', 'g'), '')
    ) AS query
  )
  SELECT c.id,
         c.content,
         c.document_id,
         ts_rank(c.fts, q.query) AS rank
  FROM ai_knowledge_chunks c, q
  WHERE c.account_id = p_account_id
    AND q.query IS NOT NULL
    AND c.fts @@ q.query
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP FUNCTION IF EXISTS public.match_ai_knowledge_semantic(uuid, text, integer);
CREATE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, content text, document_id uuid, distance real) AS $$
  SELECT c.id,
         c.content,
         c.document_id,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO authenticated, service_role;
