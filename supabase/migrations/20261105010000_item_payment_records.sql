create table public.item_payment_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  occurrence_date date not null,
  payment_date date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (item_id, occurrence_date)
);

create index item_payment_records_item_idx
  on public.item_payment_records(user_id, item_id, occurrence_date);

create trigger item_payment_records_set_updated_at
before update on public.item_payment_records
for each row execute function private.set_updated_at();

alter table public.item_payment_records enable row level security;
revoke all on table public.item_payment_records from anon, authenticated;
grant select, insert, update, delete on table public.item_payment_records to authenticated;

create policy "item_payment_records_select_own"
on public.item_payment_records for select to authenticated
using ((select auth.uid()) = user_id);

create policy "item_payment_records_insert_own"
on public.item_payment_records for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.items i
    where i.id = item_id and i.user_id = (select auth.uid())
  )
);

create policy "item_payment_records_update_own"
on public.item_payment_records for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.items i
    where i.id = item_id and i.user_id = (select auth.uid())
  )
);

create policy "item_payment_records_delete_own"
on public.item_payment_records for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.capture_item_price_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_effective date;
  v_history_start date;
begin
  if tg_op = 'UPDATE' and old.amount is not distinct from new.amount
    and old.currency is not distinct from new.currency
    and old.billing_cycle is not distinct from new.billing_cycle then
    return new;
  end if;

  select date_trunc('month', timezone(coalesce(p.timezone, 'Asia/Seoul'), now()))::date
  into v_effective
  from public.profiles p where p.id = new.user_id;
  v_effective := coalesce(
    v_effective,
    date_trunc('month', timezone('Asia/Seoul', now()))::date
  );

  if tg_op = 'UPDATE' then
    if old.management_type in ('recurring_subscription', 'other_payment_deadline')
      and old.amount is not null
      and old.currency is not null
      and old.billing_cycle in ('monthly', 'yearly')
      and not exists (
        select 1 from public.item_price_periods
        where item_id = new.id and effective_from < v_effective
      ) then
      v_history_start := coalesce(
        old.first_billing_date,
        case
          when old.start_date_precision = 'day'
            and old.start_date_value ~ '^\d{4}-\d{2}-\d{2}$'
          then old.start_date_value::date
        end,
        (
          select min(effective_from)
          from public.item_price_periods
          where item_id = new.id
        ),
        v_effective
      );

      if v_history_start < v_effective then
        insert into public.item_price_periods(
          user_id,
          item_id,
          amount,
          currency,
          billing_cycle,
          effective_from,
          effective_to
        ) values (
          new.user_id,
          new.id,
          old.amount,
          old.currency,
          old.billing_cycle,
          v_history_start,
          v_effective - 1
        )
        on conflict (item_id, effective_from) do update set
          amount = excluded.amount,
          currency = excluded.currency,
          billing_cycle = excluded.billing_cycle,
          effective_to = excluded.effective_to;
      end if;
    end if;

    delete from public.item_price_periods
    where item_id = new.id and effective_from >= v_effective;

    update public.item_price_periods
    set effective_to = v_effective - 1
    where item_id = new.id
      and effective_from < v_effective
      and (effective_to is null or effective_to >= v_effective);
  end if;

  if new.management_type not in ('recurring_subscription', 'other_payment_deadline')
    or new.amount is null or new.currency is null or new.billing_cycle not in ('monthly', 'yearly') then
    return new;
  end if;

  insert into public.item_price_periods(
    user_id,
    item_id,
    amount,
    currency,
    billing_cycle,
    effective_from
  )
  values (
    new.user_id,
    new.id,
    new.amount,
    new.currency,
    new.billing_cycle,
    v_effective
  )
  on conflict (item_id, effective_from) do update set
    amount = excluded.amount,
    currency = excluded.currency,
    billing_cycle = excluded.billing_cycle,
    effective_to = null;
  return new;
end;
$$;

create or replace function public.apply_item_price_history_to_all(
  p_item_id uuid,
  p_amount numeric,
  p_currency text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;
  if p_amount is null or p_amount < 0 or nullif(trim(p_currency), '') is null then
    raise exception 'invalid_price';
  end if;
  if not exists (
    select 1 from public.items i
    where i.id = p_item_id and i.user_id = v_user_id
  ) then
    raise exception 'item_not_found';
  end if;

  update public.item_price_periods
  set amount = p_amount, currency = p_currency
  where item_id = p_item_id and user_id = v_user_id;

  update public.item_payment_records
  set amount = p_amount, currency = p_currency
  where item_id = p_item_id and user_id = v_user_id;
end;
$$;

revoke all on function public.apply_item_price_history_to_all(uuid, numeric, text) from public;
grant execute on function public.apply_item_price_history_to_all(uuid, numeric, text) to authenticated;

create or replace function public.apply_item_price_change_from_current_month(
  p_item_id uuid,
  p_previous_amount numeric,
  p_previous_currency text,
  p_previous_billing_cycle text,
  p_history_start date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_effective date;
  v_history_start date;
  v_item public.items%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  select * into v_item
  from public.items i
  where i.id = p_item_id and i.user_id = v_user_id;
  if not found then
    raise exception 'item_not_found';
  end if;

  select date_trunc('month', timezone(coalesce(p.timezone, 'Asia/Seoul'), now()))::date
  into v_effective
  from public.profiles p where p.id = v_user_id;
  v_effective := coalesce(
    v_effective,
    date_trunc('month', timezone('Asia/Seoul', now()))::date
  );

  select coalesce(p_history_start, min(pp.effective_from), v_effective)
  into v_history_start
  from public.item_price_periods pp
  where pp.item_id = p_item_id and pp.user_id = v_user_id;

  if p_previous_amount is not null
    and p_previous_currency is not null
    and p_previous_billing_cycle in ('monthly', 'yearly')
    and v_history_start < v_effective
    and not exists (
      select 1 from public.item_price_periods pp
      where pp.item_id = p_item_id
        and pp.user_id = v_user_id
        and pp.effective_from < v_effective
    ) then
    insert into public.item_price_periods(
      user_id,
      item_id,
      amount,
      currency,
      billing_cycle,
      effective_from,
      effective_to
    ) values (
      v_user_id,
      p_item_id,
      p_previous_amount,
      p_previous_currency,
      p_previous_billing_cycle,
      v_history_start,
      v_effective - 1
    )
    on conflict (item_id, effective_from) do update set
      amount = excluded.amount,
      currency = excluded.currency,
      billing_cycle = excluded.billing_cycle,
      effective_to = excluded.effective_to;
  end if;

  delete from public.item_price_periods
  where item_id = p_item_id
    and user_id = v_user_id
    and effective_from >= v_effective;

  update public.item_price_periods
  set effective_to = v_effective - 1
  where item_id = p_item_id
    and user_id = v_user_id
    and effective_from < v_effective
    and (effective_to is null or effective_to >= v_effective);

  if v_item.management_type in ('recurring_subscription', 'other_payment_deadline')
    and v_item.amount is not null
    and v_item.currency is not null
    and v_item.billing_cycle in ('monthly', 'yearly') then
    insert into public.item_price_periods(
      user_id,
      item_id,
      amount,
      currency,
      billing_cycle,
      effective_from
    ) values (
      v_user_id,
      p_item_id,
      v_item.amount,
      v_item.currency,
      v_item.billing_cycle,
      v_effective
    )
    on conflict (item_id, effective_from) do update set
      amount = excluded.amount,
      currency = excluded.currency,
      billing_cycle = excluded.billing_cycle,
      effective_to = null;
  end if;
end;
$$;

revoke all on function public.apply_item_price_change_from_current_month(uuid, numeric, text, text, date) from public;
grant execute on function public.apply_item_price_change_from_current_month(uuid, numeric, text, text, date) to authenticated;
