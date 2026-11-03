alter table public.profiles
  add column if not exists quiet_hours_start time not null default '22:00',
  add column if not exists quiet_hours_end time not null default '08:00';

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  source_key text not null,
  event_type text not null check (event_type in ('payment', 'renewal', 'cancellation', 'review', 'expiry', 'warranty')),
  title text not null,
  event_date date not null,
  amount numeric(12, 2),
  currency text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, source_key)
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  event_id uuid references public.calendar_events(id) on delete set null,
  channel text not null check (channel in ('in_app', 'web_push')),
  idempotency_key text not null unique,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'unknown', 'retry', 'skipped', 'cancelled')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  event_id uuid references public.calendar_events(id) on delete set null,
  job_id uuid not null unique references public.notification_jobs(id) on delete cascade,
  title text not null,
  body text not null,
  target_path text,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, endpoint)
);

create index calendar_events_user_date_idx on public.calendar_events(user_id, event_date);
create index notification_jobs_due_idx on public.notification_jobs(status, scheduled_for, next_attempt_at)
  where status in ('pending', 'retry', 'unknown');
create index in_app_notifications_user_created_idx on public.in_app_notifications(user_id, created_at desc);

create trigger calendar_events_set_updated_at before update on public.calendar_events
for each row execute function private.set_updated_at();
create trigger notification_jobs_set_updated_at before update on public.notification_jobs
for each row execute function private.set_updated_at();
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
for each row execute function private.set_updated_at();

create or replace function private.cancel_calendar_event_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_jobs
  set status = 'cancelled', processed_at = timezone('utc', now()), last_error = 'schedule_changed'
  where event_id = old.id and status in ('pending', 'processing', 'retry', 'unknown');
  return old;
end;
$$;

create trigger calendar_events_cancel_notifications before delete on public.calendar_events
for each row execute function private.cancel_calendar_event_notifications();

alter table public.calendar_events enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.in_app_notifications enable row level security;
alter table public.push_subscriptions enable row level security;
revoke all on table public.calendar_events, public.notification_jobs, public.in_app_notifications, public.push_subscriptions from anon, authenticated;
grant select on table public.calendar_events, public.notification_jobs to authenticated;
grant select, update on table public.in_app_notifications to authenticated;
grant select, delete on table public.push_subscriptions to authenticated;

create policy "calendar_events_select_own" on public.calendar_events for select to authenticated
using ((select auth.uid()) = user_id);
create policy "notification_jobs_select_own" on public.notification_jobs for select to authenticated
using ((select auth.uid()) = user_id);
create policy "in_app_notifications_select_own" on public.in_app_notifications for select to authenticated
using ((select auth.uid()) = user_id);
create policy "in_app_notifications_update_own" on public.in_app_notifications for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push_subscriptions_select_own" on public.push_subscriptions for select to authenticated
using ((select auth.uid()) = user_id);
create policy "push_subscriptions_delete_own" on public.push_subscriptions for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.anchored_month_date(p_anchor date, p_months integer)
returns date language sql immutable set search_path = '' as $$
  select make_date(
    extract(year from (date_trunc('month', p_anchor) + make_interval(months => p_months)))::integer,
    extract(month from (date_trunc('month', p_anchor) + make_interval(months => p_months)))::integer,
    least(
      extract(day from p_anchor)::integer,
      extract(day from (date_trunc('month', p_anchor) + make_interval(months => p_months + 1) - interval '1 day'))::integer
    )
  );
$$;

create or replace function private.rebuild_item_phase5(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.items%rowtype;
  v_profile public.profiles%rowtype;
  v_today date;
  v_horizon date;
  v_anchor date;
  v_date date;
  v_kind text;
  v_step integer;
  v_index integer;
begin
  select * into v_item from public.items where id = p_item_id;
  if not found then return; end if;
  select * into v_profile from public.profiles where id = v_item.user_id;
  if not found then return; end if;
  v_today := timezone(v_profile.timezone, now())::date;
  v_horizon := v_today + interval '12 months';

  delete from public.calendar_events where item_id = p_item_id and event_date >= v_today;

  if coalesce(v_item.target_date_precision, '') = 'day' and v_item.target_date_value ~ '^\d{4}-\d{2}-\d{2}$' then
    v_anchor := v_item.target_date_value::date;
  elsif v_item.next_billing_date is not null then
    v_anchor := v_item.next_billing_date;
  else
    v_anchor := null;
  end if;
  if v_anchor is null then return; end if;

  if v_item.management_type = 'recurring_subscription'
    and v_item.actual_status in ('in_use', 'payment_issue') and v_item.usage_plan <> 'ended' then
    v_kind := 'payment';
    if v_item.billing_cycle in ('monthly', 'yearly') and v_item.auto_renewal_status = 'on' then
      v_step := case when v_item.billing_cycle = 'yearly' then 12 else 1 end;
      for v_index in 0..240 loop
        v_date := private.anchored_month_date(v_anchor, v_index * v_step);
        exit when v_date > v_horizon;
        if v_date >= v_today then
          insert into public.calendar_events(user_id,item_id,source_key,event_type,title,event_date,amount,currency)
          values(v_item.user_id,v_item.id,v_item.id||':payment:'||v_date,'payment',v_item.service_name,v_date,v_item.amount,v_item.currency);
        end if;
      end loop;
    elsif v_anchor between v_today and v_horizon then
      insert into public.calendar_events(user_id,item_id,source_key,event_type,title,event_date,amount,currency)
      values(v_item.user_id,v_item.id,v_item.id||':payment:'||v_anchor,'payment',v_item.service_name,v_anchor,v_item.amount,v_item.currency);
    end if;
  elsif v_anchor between v_today and v_horizon and v_item.lifecycle_status not in ('used','ended','expired') then
    v_kind := case
      when v_item.management_type = 'fixed_term_membership' and v_item.auto_renewal_status = 'on' then 'renewal'
      when v_item.management_type in ('gifticon','coupon','voucher','points','fixed_term_membership') then 'expiry'
      when v_item.management_type = 'warranty' then 'warranty'
      else 'review' end;
    insert into public.calendar_events(user_id,item_id,source_key,event_type,title,event_date)
    values(v_item.user_id,v_item.id,v_item.id||':'||v_kind||':'||v_anchor,v_kind,v_item.service_name,v_anchor);
  end if;

  insert into public.notification_jobs(user_id,item_id,event_id,channel,idempotency_key,scheduled_for)
  select e.user_id,e.item_id,e.id,c.channel,
    e.source_key||':'||d.days_before||':'||c.channel,
    ((e.event_date - d.days_before + v_item.reminder_time) at time zone v_profile.timezone)
  from public.calendar_events e
  cross join unnest(v_item.reminder_days_before) as d(days_before)
  cross join lateral (
    select 'in_app'::text as channel where v_profile.in_app_notifications_enabled
    union all select 'web_push'::text where v_profile.push_notifications_enabled
  ) c
  where e.item_id = v_item.id
    and ((e.event_date - d.days_before + v_item.reminder_time) at time zone v_profile.timezone) >= now()
  on conflict (idempotency_key) do update set
    event_id = excluded.event_id,
    scheduled_for = excluded.scheduled_for,
    status = case when public.notification_jobs.status = 'sent' then 'sent' else 'pending' end,
    attempts = case when public.notification_jobs.status = 'sent' then public.notification_jobs.attempts else 0 end,
    next_attempt_at = null,
    last_error = null,
    processed_at = case when public.notification_jobs.status = 'sent' then public.notification_jobs.processed_at else null end;
end;
$$;

create or replace function private.items_phase5_sync_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.rebuild_item_phase5(new.id);
  return new;
end;
$$;

create trigger items_phase5_sync after insert or update of
  management_type,service_name,amount,currency,billing_cycle,next_billing_date,target_date_value,
  target_date_precision,lifecycle_status,actual_status,auto_renewal_status,usage_plan,
  reminder_days_before,reminder_time
on public.items for each row execute function private.items_phase5_sync_trigger();

create or replace function private.profiles_phase5_sync_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select id from public.items where user_id = new.id loop
    perform private.rebuild_item_phase5(v_id);
  end loop;
  return new;
end;
$$;

create trigger profiles_phase5_sync after update of
  timezone,in_app_notifications_enabled,push_notifications_enabled
on public.profiles for each row execute function private.profiles_phase5_sync_trigger();

create or replace function public.refresh_phase5_schedules()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select i.id
    from public.items i
    join public.profiles p on p.id = i.user_id
    where i.management_type = 'recurring_subscription'
      and i.auto_renewal_status = 'on'
      and coalesce(
        (select max(e.event_date) from public.calendar_events e where e.item_id = i.id),
        date '1970-01-01'
      ) < (timezone(p.timezone, now())::date + interval '11 months')
  loop
    perform private.rebuild_item_phase5(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.refresh_phase5_schedules() from public, anon, authenticated;
grant execute on function public.refresh_phase5_schedules() to service_role;

do $$ declare v_id uuid; begin
  for v_id in select id from public.items loop
    perform private.rebuild_item_phase5(v_id);
  end loop;
end $$;

comment on table public.calendar_events is 'Phase 5 internal schedules generated from confirmed item dates.';
comment on table public.notification_jobs is 'Idempotent in-app and Web Push delivery jobs; external delivery may remain unknown.';
