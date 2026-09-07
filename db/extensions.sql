-- Optional pgvector enablement (best-effort; retrieval falls back to
-- PostgreSQL full-text search when vectors are absent).
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS chunk_embedding_idx ON "Chunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
