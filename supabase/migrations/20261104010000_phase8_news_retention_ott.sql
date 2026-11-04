alter table public.service_catalogs
  add column if not exists is_ott_editorial boolean not null default false;

alter table public.service_news
  drop constraint if exists service_news_status_check;
alter table public.service_news
  add constraint service_news_status_check
  check (status in ('draft','pending_review','published','archived','hidden')),
  add column if not exists is_ott_schedule boolean not null default false;

create index if not exists service_news_ott_schedule_idx
  on public.service_news(is_ott_schedule, status, announced_on desc)
  where is_ott_schedule = true;

create or replace function public.cleanup_old_service_news()
returns table(archived_count integer, deleted_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_archived integer := 0;
  v_deleted integer := 0;
begin
  update public.service_news
  set status = 'archived', updated_at = timezone('utc', now())
  where status = 'published'
    and (
      (is_ott_schedule = true and coalesce(applies_on, announced_on, collected_at::date) < current_date - 90)
      or
      (is_ott_schedule = false and coalesce(applies_on, announced_on, collected_at::date) < (current_date - interval '12 months')::date)
    );
  get diagnostics v_archived = row_count;

  delete from public.service_news n
  where n.status = 'archived'
    and coalesce(n.applies_on, n.announced_on, n.collected_at::date) < (current_date - interval '24 months')::date
    and not exists (
      select 1 from public.user_news_scraps s where s.news_id = n.id
    );
  get diagnostics v_deleted = row_count;

  return query select v_archived, v_deleted;
end $$;

revoke all on function public.cleanup_old_service_news() from public, anon, authenticated;
comment on function public.cleanup_old_service_news is
  'Archives old news and deletes only un-scrapped archived news after 24 months.';

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
      and (c.active_subscriber_count > 0 or c.is_ott_editorial = true)
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
