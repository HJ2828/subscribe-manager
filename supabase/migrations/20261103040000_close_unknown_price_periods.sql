create or replace function private.capture_item_price_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_effective date;
begin
  if tg_op = 'UPDATE' and old.amount is not distinct from new.amount
    and old.currency is not distinct from new.currency
    and old.billing_cycle is not distinct from new.billing_cycle then
    return new;
  end if;

  select timezone(coalesce(p.timezone, 'Asia/Seoul'), now())::date into v_effective
  from public.profiles p where p.id = new.user_id;
  v_effective := coalesce(v_effective, timezone('Asia/Seoul', now())::date);

  if tg_op = 'UPDATE' then
    delete from public.item_price_periods
    where item_id = new.id and effective_from = v_effective;
    update public.item_price_periods
    set effective_to = v_effective - 1
    where item_id = new.id and effective_to is null and effective_from < v_effective;
  end if;

  if new.management_type not in ('recurring_subscription', 'other_payment_deadline')
    or new.amount is null or new.currency is null or new.billing_cycle not in ('monthly', 'yearly') then
    return new;
  end if;

  insert into public.item_price_periods(user_id, item_id, amount, currency, billing_cycle, effective_from)
  values (new.user_id, new.id, new.amount, new.currency, new.billing_cycle, v_effective)
  on conflict (item_id, effective_from) do update set
    amount = excluded.amount, currency = excluded.currency, billing_cycle = excluded.billing_cycle;
  return new;
end;
$$;
