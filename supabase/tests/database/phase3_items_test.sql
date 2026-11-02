\set ON_ERROR_STOP on

begin;

select '1..10';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.item_deletion_jobs'::regclass) then
    raise exception 'item deletion jobs must have RLS enabled';
  end if;
end;
$$;
select 'ok 1 - item deletion jobs has RLS enabled';

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'phase3-a@example.test', '', now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'phase3-b@example.test', '', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.items (user_id, management_type, service_name, amount, currency, target_date_value, target_date_precision)
select
  '44444444-4444-4444-4444-444444444444',
  management_type,
  management_type,
  case when management_type = 'points' then 0 else null end,
  null,
  case when management_type = 'other_deadline' then '2026-11' else null end,
  case when management_type = 'other_deadline' then 'month' else null end
from unnest(array[
  'recurring_subscription', 'fixed_term_membership', 'gifticon', 'coupon',
  'voucher', 'points', 'warranty', 'other_deadline'
]) as management_type;

do $$
begin
  if (select count(*) from public.items) <> 8 then
    raise exception 'all eight Phase 3 management types must be saved';
  end if;
end;
$$;
select 'ok 2 - all Phase 3 management types can be saved';

do $$
begin
  if not exists (
    select 1 from public.items
    where management_type = 'other_deadline'
      and target_date_value = '2026-11'
      and target_date_precision = 'month'
  ) then
    raise exception 'month precision was not preserved';
  end if;
end;
$$;
select 'ok 3 - month precision is preserved without an invented day';

do $$
begin
  begin
    insert into public.items (user_id, management_type, service_name, target_date_value, target_date_precision)
    values ('44444444-4444-4444-4444-444444444444', 'other_deadline', 'invalid date', '2026-11-01', 'month');
    raise exception 'mismatched date precision was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;
select 'ok 4 - mismatched date precision is rejected';

do $$
begin
  if not exists (
    select 1 from public.items
    where management_type = 'points' and amount = 0
  ) then
    raise exception 'confirmed zero must be stored as zero';
  end if;
  if not exists (
    select 1 from public.items
    where management_type = 'gifticon' and amount is null
  ) then
    raise exception 'unknown amount must remain null';
  end if;
end;
$$;
select 'ok 5 - confirmed zero and unknown amount remain distinct';

do $$
begin
  begin
    insert into public.items (user_id, management_type, service_name)
    values ('55555555-5555-5555-5555-555555555555', 'gifticon', 'other user item');
    raise exception 'user inserted an item for another owner';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end;
$$;
select 'ok 6 - user cannot insert another owner item';

insert into public.item_deletion_jobs (
  user_id, item_id, item_name, management_type,
  internal_status, image_cleanup_status, calendar_cleanup_status, relationship_cleanup_status
)
select
  user_id, id, service_name, management_type,
  'pending', 'not_applicable', 'not_applicable', 'not_applicable'
from public.items
where management_type = 'gifticon'
limit 1;
select 'ok 7 - owner can create an item deletion job';

do $$
begin
  if (select count(*) from public.item_deletion_jobs) <> 1 then
    raise exception 'owner must see their deletion job';
  end if;
end;
$$;
select 'ok 8 - owner can read their deletion job';

do $$
begin
  begin
    insert into public.item_deletion_jobs (user_id, item_name, management_type)
    values ('55555555-5555-5555-5555-555555555555', 'other user job', 'gifticon');
    raise exception 'user inserted another owner deletion job';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end;
$$;
select 'ok 9 - user cannot create another owner deletion job';

update public.item_deletion_jobs
set internal_status = 'deleted', item_id = null
where user_id = '44444444-4444-4444-4444-444444444444';

do $$
begin
  if not exists (
    select 1 from public.item_deletion_jobs
    where internal_status = 'deleted'
      and image_cleanup_status = 'not_applicable'
      and calendar_cleanup_status = 'not_applicable'
  ) then
    raise exception 'internal and future cleanup states must remain separate';
  end if;
end;
$$;
select 'ok 10 - internal and future cleanup results are stored separately';

rollback;
