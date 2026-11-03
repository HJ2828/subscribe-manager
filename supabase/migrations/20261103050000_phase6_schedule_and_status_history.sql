create table public.item_status_history (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  event_type text not null check (event_type in ('tracking_started', 'paused', 'ended', 'resumed', 'status_changed')),
  previous_status text, current_status text not null, occurred_on date not null,
  created_at timestamptz not null default timezone('utc', now())
);
create index item_status_history_item_date_idx on public.item_status_history(user_id, item_id, occurred_on desc);
alter table public.item_status_history enable row level security;
revoke all on table public.item_status_history from anon, authenticated;
grant select on table public.item_status_history to authenticated;
create policy "item_status_history_select_own" on public.item_status_history for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.capture_item_status_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_date date; v_event text;
begin
  if old.actual_status is not distinct from new.actual_status then return new; end if;
  select timezone(coalesce(p.timezone, 'Asia/Seoul'), now())::date into v_date from public.profiles p where p.id = new.user_id;
  v_date := coalesce(v_date, timezone('Asia/Seoul', now())::date);
  v_event := case when new.actual_status = 'temporarily_paused' then 'paused' when new.actual_status = 'ended' then 'ended'
    when new.actual_status = 'in_use' and old.actual_status in ('ended', 'temporarily_paused') then 'resumed' else 'status_changed' end;
  insert into public.item_status_history(user_id,item_id,event_type,previous_status,current_status,occurred_on)
  values(new.user_id,new.id,v_event,old.actual_status,new.actual_status,v_date);
  return new;
end;
$$;
create trigger items_capture_status_history after update of actual_status on public.items
for each row execute function private.capture_item_status_history();
insert into public.item_status_history(user_id,item_id,event_type,current_status,occurred_on)
select i.user_id,i.id,'tracking_started',i.actual_status,timezone(coalesce(p.timezone,'Asia/Seoul'),now())::date
from public.items i join public.profiles p on p.id=i.user_id;

create or replace function public.set_calendar_event_schedule_status(p_event_id uuid,p_status text)
returns public.calendar_events language plpgsql security definer set search_path = '' as $$
declare v_event public.calendar_events%rowtype;
begin
  if p_status not in ('scheduled','cancelled','skipped') then raise exception 'invalid_schedule_status'; end if;
  update public.calendar_events set schedule_status=p_status
  where id=p_event_id and user_id=(select auth.uid()) and event_type='payment' returning * into v_event;
  if not found then raise exception 'calendar_event_not_found'; end if;
  return v_event;
end;
$$;
revoke all on function public.set_calendar_event_schedule_status(uuid,text) from public,anon;
grant execute on function public.set_calendar_event_schedule_status(uuid,text) to authenticated;
