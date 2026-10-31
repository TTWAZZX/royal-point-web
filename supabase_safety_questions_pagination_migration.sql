-- Indexes for server-side Safety Questions pagination, filters and search.
-- Existing questions and daily check-in history are not modified.
create extension if not exists pg_trgm;

create index if not exists safety_questions_created_id_idx
  on public.safety_questions (created_at desc, id desc);

create index if not exists safety_questions_updated_id_idx
  on public.safety_questions (updated_at desc, id desc);

create index if not exists safety_questions_source_created_idx
  on public.safety_questions (source, created_at desc);

create index if not exists safety_questions_question_trgm_idx
  on public.safety_questions using gin (question gin_trgm_ops);
