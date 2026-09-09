-- Adds the canonical pair key that makes duplicate DIRECT conversations
-- impossible (see the `pairKey` comment on the Conversation model).
--
-- find-then-create is not atomic: two concurrent requests can both observe no
-- existing thread and both insert one, splitting a conversation in two. The
-- unique index below is the actual guarantee; the application's lookup is only
-- the fast path.

ALTER TABLE "conversations" ADD COLUMN "pair_key" TEXT;

-- Backfill existing DIRECT conversations. Without this they keep a NULL
-- pair_key, and because Postgres allows unlimited NULLs in a unique index the
-- constraint would not protect them -- every pre-existing DM could still be
-- duplicated by the next request.
UPDATE "conversations" c
SET "pair_key" = sub.key
FROM (
  SELECT p."conversation_id" AS id,
         string_agg(p."user_id", ':' ORDER BY p."user_id") AS key
  FROM "conversation_participants" p
  GROUP BY p."conversation_id"
  HAVING count(*) = 2
) sub
WHERE c."id" = sub.id
  AND c."type" = 'DIRECT';

CREATE UNIQUE INDEX "conversations_pair_key_key" ON "conversations"("pair_key");
