alter table public.service_catalogs
  add column if not exists canonical_key text,
  add column if not exists active_subscriber_count integer not null default 0 check (active_subscriber_count >= 0),
  add column if not exists next_news_check_at timestamptz,
  add column if not exists collection_lease_until timestamptz;

create unique index if not exists service_catalogs_canonical_key_key
  on public.service_catalogs(canonical_key);
create index if not exists service_catalogs_news_due_idx
  on public.service_catalogs(active_subscriber_count, next_news_check_at, last_news_check_at);

alter table public.content_collection_runs drop constraint if exists content_collection_runs_outcome_check;
alter table public.content_collection_runs
  add constraint content_collection_runs_outcome_check check (outcome in (
    'reserved','new_content','no_new_content','search_failed','source_failed',
    'precheck_failed','unchanged','conditions_unconfirmed','budget_limited'
  )),
  add column if not exists status text not null default 'finished'
    check (status in ('reserved','running','finished','failed')),
  add column if not exists reservation_token uuid,
  add column if not exists reserved_cost_usd numeric(10,6) not null default 0 check (reserved_cost_usd >= 0),
  add column if not exists actual_cost_usd numeric(10,6) check (actual_cost_usd is null or actual_cost_usd >= 0),
  add column if not exists actual_cost_known boolean not null default false,
  add column if not exists api_request_count integer not null default 0 check (api_request_count >= 0),
  add column if not exists web_search_call_count integer not null default 0 check (web_search_call_count >= 0),
  add column if not exists input_tokens integer not null default 0 check (input_tokens >= 0),
  add column if not exists cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  add column if not exists output_tokens integer not null default 0 check (output_tokens >= 0),
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

update public.content_collection_runs
  set reserved_cost_usd = estimated_cost_usd
  where reserved_cost_usd = 0 and estimated_cost_usd > 0;

create unique index if not exists content_collection_runs_active_catalog_key
  on public.content_collection_runs(catalog_id, content_kind)
  where status in ('reserved','running');

create table if not exists public.service_collection_sources (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.service_catalogs(id) on delete cascade,
  source_url text not null check (source_url ~ '^https://'),
  source_kind text not null default 'feed' check (source_kind in ('rss','atom','json','conditional_page')),
  etag text,
  last_modified text,
  content_hash text,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  unique(catalog_id, source_url)
);

alter table public.service_collection_sources enable row level security;
revoke all on table public.service_collection_sources from anon, authenticated;

alter table public.service_news
  add column if not exists announcement_key text,
  add column if not exists official_item_id text,
  add column if not exists collected_at timestamptz not null default timezone('utc', now()),
  add column if not exists last_verified_at timestamptz;

create unique index if not exists service_news_announcement_key
  on public.service_news(catalog_id, announcement_key) where announcement_key is not null;

create table if not exists public.user_news_scraps (
  user_id uuid not null references auth.users(id) on delete cascade,
  news_id uuid not null references public.service_news(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key(user_id, news_id)
);

alter table public.user_news_scraps enable row level security;
create policy "users read own news scraps" on public.user_news_scraps
  for select to authenticated using (auth.uid() = user_id);
create policy "users create own news scraps" on public.user_news_scraps
  for insert to authenticated with check (auth.uid() = user_id);
create policy "users delete own news scraps" on public.user_news_scraps
  for delete to authenticated using (auth.uid() = user_id);
grant select, insert, delete on public.user_news_scraps to authenticated;

create or replace function public.claim_content_collection_job(
  p_catalog_id uuid,
  p_daily_job_limit integer,
  p_daily_cost_limit numeric,
  p_total_cost_limit numeric,
  p_reserved_cost numeric,
  p_interval_hours integer
) returns table(run_id uuid, reservation_token uuid, claim_status text)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_day timestamptz := date_trunc('day', v_now);
  v_daily_jobs integer;
  v_daily_cost numeric;
  v_total_cost numeric;
  v_token uuid := gen_random_uuid();
  v_run_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('phase8-content-budget'));
  perform 1 from public.service_catalogs where id = p_catalog_id for update;
  if not found then return; end if;
  if exists (
    select 1 from public.content_collection_runs r
      join public.service_catalogs c on c.id = r.catalog_id
      where r.catalog_id = p_catalog_id and r.content_kind = 'news'
        and r.status in ('reserved','running')
        and coalesce(c.collection_lease_until, '-infinity'::timestamptz) <= v_now
  ) then
    update public.content_collection_runs set
      status = 'failed', outcome = 'search_failed', finished_at = v_now,
      details = 'stale lease; reservation retained because actual cost is unknown'
      where catalog_id = p_catalog_id and content_kind = 'news' and status in ('reserved','running');
    update public.service_catalogs set
      collection_lease_until = null,
      last_news_check_at = v_now,
      next_news_check_at = v_now + make_interval(hours => p_interval_hours)
      where id = p_catalog_id;
    return;
  end if;
  if not exists (
    select 1 from public.service_catalogs c where c.id = p_catalog_id
      and c.active_subscriber_count > 0
      and coalesce(c.next_news_check_at, '-infinity'::timestamptz) <= v_now
      and coalesce(c.collection_lease_until, '-infinity'::timestamptz) <= v_now
  ) then return; end if;

  select count(*) into v_daily_jobs from public.content_collection_runs
    where content_kind = 'news' and created_at >= v_day
      and status in ('reserved','running','finished','failed') and outcome <> 'budget_limited';
  select coalesce(sum(case when actual_cost_known then actual_cost_usd else reserved_cost_usd end), 0)
    into v_daily_cost from public.content_collection_runs where created_at >= v_day;
  select coalesce(sum(case when actual_cost_known then actual_cost_usd else reserved_cost_usd end), 0)
    into v_total_cost from public.content_collection_runs;

  if v_daily_jobs >= p_daily_job_limit
    or v_daily_cost + p_reserved_cost > p_daily_cost_limit
    or v_total_cost + p_reserved_cost > p_total_cost_limit then
    select id into v_run_id from public.content_collection_runs
      where catalog_id = p_catalog_id and content_kind = 'news'
        and outcome = 'budget_limited' and created_at >= v_day limit 1;
    if v_run_id is null then
      insert into public.content_collection_runs(
        catalog_id, content_kind, outcome, status, details, finished_at
      ) values (
        p_catalog_id, 'news', 'budget_limited', 'finished',
        'service job, daily cost, or development cost limit reached before external call', v_now
      ) returning id into v_run_id;
    end if;
    return query select v_run_id, null::uuid, 'budget_limited'::text;
    return;
  end if;

  insert into public.content_collection_runs(
    catalog_id, content_kind, outcome, status, reservation_token,
    reserved_cost_usd, estimated_cost_usd, started_at
  ) values (
    p_catalog_id, 'news', 'reserved', 'reserved', v_token,
    p_reserved_cost, p_reserved_cost, v_now
  ) returning id into v_run_id;
  update public.service_catalogs set collection_lease_until = v_now + interval '15 minutes'
    where id = p_catalog_id;
  return query select v_run_id, v_token, 'claimed'::text;
end $$;

revoke all on function public.claim_content_collection_job(uuid,integer,numeric,numeric,numeric,integer) from public, anon, authenticated;
comment on table public.user_news_scraps is 'User-owned relation to shared news; news bodies are not copied.';
comment on function public.claim_content_collection_job is 'Atomically reserves one shared service job and its budget before any paid request.';
