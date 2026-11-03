alter table public.items drop constraint if exists items_management_type_check;
alter table public.items add constraint items_management_type_check check (management_type in (
  'recurring_subscription', 'other_payment_deadline', 'fixed_term_membership', 'gifticon',
  'coupon', 'voucher', 'points', 'warranty', 'other_deadline'
));

alter table public.image_assets drop constraint if exists image_assets_management_type_check;
alter table public.image_assets add constraint image_assets_management_type_check check (management_type in (
  'recurring_subscription', 'other_payment_deadline', 'fixed_term_membership', 'gifticon',
  'coupon', 'voucher', 'points', 'warranty', 'other_deadline'
));

alter table public.notification_jobs add column if not exists days_before smallint;
update public.notification_jobs
set days_before = split_part(idempotency_key, ':', array_length(string_to_array(idempotency_key, ':'), 1) - 1)::smallint
where days_before is null;
alter table public.notification_jobs alter column days_before set not null;

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

  if v_item.management_type in ('recurring_subscription', 'other_payment_deadline')
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

  insert into public.notification_jobs(user_id,item_id,event_id,channel,idempotency_key,scheduled_for,days_before)
  select e.user_id,e.item_id,e.id,c.channel,
    e.source_key||':'||d.days_before||':'||c.channel,
    ((e.event_date - d.days_before + v_item.reminder_time) at time zone v_profile.timezone),
    d.days_before
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
    days_before = excluded.days_before,
    status = case when public.notification_jobs.status = 'sent' then 'sent' else 'pending' end,
    attempts = case when public.notification_jobs.status = 'sent' then public.notification_jobs.attempts else 0 end,
    next_attempt_at = null,
    last_error = null,
    processed_at = case when public.notification_jobs.status = 'sent' then public.notification_jobs.processed_at else null end;
end;
$$;

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
    where i.management_type in ('recurring_subscription', 'other_payment_deadline')
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
