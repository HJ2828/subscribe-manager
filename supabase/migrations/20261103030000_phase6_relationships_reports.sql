alter table public.calendar_events
  add column if not exists schedule_status text not null default 'scheduled'
  check (schedule_status in ('scheduled', 'cancelled', 'skipped'));

create table public.subscription_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_item_id uuid not null references public.items(id) on delete restrict,
  child_item_id uuid not null references public.items(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('included_benefit', 'additional_charge', 'unknown_cost')),
  cost_item_id uuid references public.items(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint subscription_relationship_distinct_items check (parent_item_id <> child_item_id),
  constraint subscription_relationship_cost_target check (cost_item_id is null or cost_item_id in (parent_item_id, child_item_id)),
  constraint subscription_relationship_type_cost check (
    (relationship_type = 'included_benefit' and cost_item_id = parent_item_id) or
    (relationship_type = 'additional_charge' and cost_item_id = child_item_id) or
    (relationship_type = 'unknown_cost' and cost_item_id is null)
  ),
  unique (user_id, child_item_id)
);

create table public.item_price_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default timezone('utc', now()),
  constraint item_price_period_valid_range check (effective_to is null or effective_to >= effective_from),
  unique (item_id, effective_from)
);

create index subscription_relationships_parent_idx on public.subscription_relationships(user_id, parent_item_id);
create index item_price_periods_item_range_idx on public.item_price_periods(user_id, item_id, effective_from);

create trigger subscription_relationships_set_updated_at before update on public.subscription_relationships
for each row execute function private.set_updated_at();

alter table public.subscription_relationships enable row level security;
alter table public.item_price_periods enable row level security;
revoke all on table public.subscription_relationships, public.item_price_periods from anon, authenticated;
grant select, insert, update, delete on table public.subscription_relationships to authenticated;
grant select on table public.item_price_periods to authenticated;

create policy "subscription_relationships_select_own" on public.subscription_relationships for select to authenticated
using ((select auth.uid()) = user_id);
create policy "subscription_relationships_insert_own" on public.subscription_relationships for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "subscription_relationships_update_own" on public.subscription_relationships for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "subscription_relationships_delete_own" on public.subscription_relationships for delete to authenticated
using ((select auth.uid()) = user_id);
create policy "item_price_periods_select_own" on public.item_price_periods for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.validate_subscription_relationship()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_parent_user uuid;
  v_child_user uuid;
  v_cost_user uuid;
begin
  select user_id into v_parent_user from public.items where id = new.parent_item_id;
  select user_id into v_child_user from public.items where id = new.child_item_id;
  if new.cost_item_id is not null then
    select user_id into v_cost_user from public.items where id = new.cost_item_id;
  end if;
  if v_parent_user is null or v_child_user is null or v_parent_user <> new.user_id or v_child_user <> new.user_id
    or (new.cost_item_id is not null and v_cost_user <> new.user_id) then
    raise exception 'relationship_items_must_belong_to_user';
  end if;
  if exists (
    with recursive ancestors(id) as (
      select new.parent_item_id
      union all
      select r.parent_item_id from public.subscription_relationships r join ancestors a on r.child_item_id = a.id
      where r.user_id = new.user_id and r.id <> coalesce(new.id, gen_random_uuid())
    ) select 1 from ancestors where id = new.child_item_id
  ) then
    raise exception 'relationship_cycle_not_allowed';
  end if;
  return new;
end;
$$;

create trigger subscription_relationships_validate before insert or update on public.subscription_relationships
for each row execute function private.validate_subscription_relationship();

create or replace function private.capture_item_price_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_effective date;
begin
  if new.management_type not in ('recurring_subscription', 'other_payment_deadline')
    or new.amount is null or new.currency is null or new.billing_cycle not in ('monthly', 'yearly') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.amount is not distinct from new.amount
    and old.currency is not distinct from new.currency
    and old.billing_cycle is not distinct from new.billing_cycle then
    return new;
  end if;
  select timezone(coalesce(p.timezone, 'Asia/Seoul'), now())::date into v_effective
  from public.profiles p where p.id = new.user_id;
  v_effective := coalesce(v_effective, timezone('Asia/Seoul', now())::date);
  update public.item_price_periods
  set effective_to = v_effective - 1
  where item_id = new.id and effective_to is null and effective_from < v_effective;
  insert into public.item_price_periods(user_id, item_id, amount, currency, billing_cycle, effective_from)
  values (new.user_id, new.id, new.amount, new.currency, new.billing_cycle, v_effective)
  on conflict (item_id, effective_from) do update set
    amount = excluded.amount, currency = excluded.currency, billing_cycle = excluded.billing_cycle;
  return new;
end;
$$;

create trigger items_capture_price_period after insert or update of amount, currency, billing_cycle on public.items
for each row execute function private.capture_item_price_period();

insert into public.item_price_periods(user_id, item_id, amount, currency, billing_cycle, effective_from)
select i.user_id, i.id, i.amount, i.currency, i.billing_cycle,
  timezone(coalesce(p.timezone, 'Asia/Seoul'), now())::date
from public.items i join public.profiles p on p.id = i.user_id
where i.management_type in ('recurring_subscription', 'other_payment_deadline')
  and i.amount is not null and i.currency is not null and i.billing_cycle in ('monthly', 'yearly')
on conflict (item_id, effective_from) do nothing;
