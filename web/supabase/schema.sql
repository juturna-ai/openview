-- OpenView Reports — AI-generated market reports + an anonymous public wall.
--
-- Project: koedodxkryyxizcryggy (the Openview project — NOT the music-events project that the
-- read-only Supabase MCP happens to point at). Apply via the Supabase SQL editor, `supabase db
-- push`, or the Management API query endpoint. Safe to re-run: every statement is idempotent.
--
-- ── SECURITY MODEL — read this before adding a policy ──
--
-- This feature has NO login. Every table below grants **public SELECT and nothing else**. There is
-- deliberately no insert/update/delete policy for `anon`/`authenticated`: RLS denies by default, so
-- the anon key that ships to the browser can read reports and write nothing.
--
-- Every write goes through a server route holding SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS
-- entirely. Those routes validate input and rate-limit by IP. If you ever add a "public insert"
-- policy here, you hand anyone who opens DevTools the ability to write directly to these tables,
-- and the rate limiter becomes decorative. Don't.

create extension if not exists pgcrypto;

-- ── Reports ──────────────────────────────────────────────────────────────────────────────────
-- One row per generated report. `coins` / `binance_pairs` are jsonb rather than child rows on
-- purpose: the ranked list is written once and always read whole (it renders as one table), never
-- queried or filtered per-coin, so a join would buy nothing and would complicate the upsert below.
create table if not exists public.reports (
  id            uuid        primary key default gen_random_uuid(),
  period        text        not null check (period in ('daily','weekly','monthly')),
  -- The UTC calendar date this report covers. Together with `period` this is the idempotency key:
  -- Vercel does NOT guarantee at-most-once cron delivery, so a retry must overwrite this row
  -- rather than post a second report for the same day. See the unique constraint below.
  report_date   date        not null,
  -- RankedCoin[] — {id,symbol,name,slug,thumb,cmcRank,price,changePct,volume,marketCap,turnover}
  coins         jsonb       not null default '[]'::jsonb,
  -- RankedPair[] — {symbol,base,changePct,lastPrice,quoteVolume}
  binance_pairs jsonb       not null default '[]'::jsonb,
  -- Fear & Greed + CMC trending/most-visited/recently-added, denormalised so a stored report stays
  -- self-contained even if those endpoints change shape or disappear.
  sentiment     jsonb       not null default '{}'::jsonb,
  -- LlmAnalysis, or NULL when the model failed / there was nothing to analyse. NULL is a valid,
  -- honest state — the report still renders its data. Never backfill this with a placeholder.
  analysis      jsonb,
  llm_provider  text        check (llm_provider is null or llm_provider in ('gemini','groq')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (period, report_date)
);

alter table public.reports enable row level security;

do $$ begin
  create policy "reports - public select" on public.reports for select using (true);
exception when duplicate_object then null; end $$;

-- Feed ordering (newest first) and the per-period "latest report" lookup both ride this.
create index if not exists reports_period_date_idx on public.reports (period, report_date desc);
create index if not exists reports_created_idx on public.reports (created_at desc);

-- ── Comments ─────────────────────────────────────────────────────────────────────────────────
-- Relational (not jsonb) because these ARE many-per-report, arrive independently over time, and
-- need their own ordering and a moderation surface later.
--
-- `nickname` is unverified by design — there are no accounts, so anyone can type any name. The UI
-- says so. Don't treat it as identity.
create table if not exists public.report_comments (
  id          uuid        primary key default gen_random_uuid(),
  report_id   uuid        not null references public.reports(id) on delete cascade,
  nickname    text        not null check (char_length(nickname) between 1 and 32),
  body        text        not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

alter table public.report_comments enable row level security;

do $$ begin
  create policy "comments - public select" on public.report_comments for select using (true);
exception when duplicate_object then null; end $$;

create index if not exists report_comments_report_idx on public.report_comments (report_id, created_at);

-- ── Reactions ────────────────────────────────────────────────────────────────────────────────
-- A tally per (report, emoji), not one row per click: with no auth there's no honest way to dedupe
-- a visitor, so a uniqueness constraint would be theatre. The write route's rate limit is what
-- keeps this sane.
create table if not exists public.report_reactions (
  report_id   uuid        not null references public.reports(id) on delete cascade,
  emoji       text        not null check (char_length(emoji) <= 8),
  count       integer     not null default 0 check (count >= 0),
  updated_at  timestamptz not null default now(),
  primary key (report_id, emoji)
);

alter table public.report_reactions enable row level security;

do $$ begin
  create policy "reactions - public select" on public.report_reactions for select using (true);
exception when duplicate_object then null; end $$;

-- Atomic increment. A read-then-write from the route would drop concurrent clicks (classic
-- lost-update race); `count = count + 1` inside the upsert is resolved by Postgres under the row
-- lock, so simultaneous reactions all land.
--
-- security definer + no grant to anon/authenticated => callable by the service_role key only,
-- consistent with "no client writes". Do not grant execute to anon.
create or replace function public.increment_reaction(p_report_id uuid, p_emoji text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.report_reactions (report_id, emoji, count, updated_at)
  values (p_report_id, p_emoji, 1, now())
  on conflict (report_id, emoji) do update
    set count = report_reactions.count + 1, updated_at = now()
  returning count into new_count;
  return new_count;
end;
$$;

revoke all on function public.increment_reaction(uuid, text) from public, anon, authenticated;

-- ── keep_alive ───────────────────────────────────────────────────────────────────────────────
-- Supabase pauses a free-tier project after 7 days with no activity. /api/keep-alive (Vercel cron,
-- 09:00 UTC) does a real anon-key SELECT against this table to reset that timer, and returns 500 on
-- zero rows so a deleted row surfaces instead of reporting false success — hence the seeded row.
--
-- This table lives here because NEXT_PUBLIC_SUPABASE_URL now points at THIS project; without it the
-- existing keep-alive cron would 500 every day. (The reports cron also writes daily, which is
-- activity in its own right — this is belt and braces for the stretch where no report generates.)
create table if not exists public.keep_alive (
  note text
);

alter table public.keep_alive enable row level security;

do $$ begin
  create policy "keep_alive_select_anon" on public.keep_alive for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

-- Exactly one row, seeded only if empty (so re-running this file never duplicates it).
insert into public.keep_alive (note)
select 'Row read daily by /api/keep-alive to stop Supabase pausing this project. Do not delete.'
where not exists (select 1 from public.keep_alive);
