\set ON_ERROR_STOP on

begin;

select '1..11';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.subscription_relationships'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.item_price_periods'::regclass) then
    raise exception 'Phase 6 tables must have RLS enabled';
  end if;
end;
$$;
select 'ok 1 - Phase 6 tables have RLS enabled';

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'phase6-a@example.test', '', now(), now()),
  ('77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'phase6-b@example.test', '', now(), now());

insert into public.profiles (id) values
  ('66666666-6666-6666-6666-666666666666'),
  ('77777777-7777-7777-7777-777777777777')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.items (id, user_id, management_type, service_name, amount, currency, billing_cycle)
values
  ('aaaaaaaa-6666-6666-6666-666666666666', '66666666-6666-6666-6666-666666666666', 'recurring_subscription', 'Parent', 10000, 'KRW', 'monthly'),
  ('bbbbbbbb-6666-6666-6666-666666666666', '66666666-6666-6666-6666-666666666666', 'recurring_subscription', 'Child', 5000, 'KRW', 'monthly');

do $$
begin
  if (select count(*) from public.item_price_periods) <> 2 then
    raise exception 'price periods were not captured';
  end if;
end;
$$;
select 'ok 2 - known recurring prices create price periods';

insert into public.subscription_relationships (
  user_id, parent_item_id, child_item_id, relationship_type, cost_item_id
) values (
  '66666666-6666-6666-6666-666666666666',
  'aaaaaaaa-6666-6666-6666-666666666666',
  'bbbbbbbb-6666-6666-6666-666666666666',
  'included_benefit',
  'aaaaaaaa-6666-6666-6666-666666666666'
);
select 'ok 3 - owner can create an included benefit relationship';

do $$
begin
  begin
    update public.subscription_relationships
    set relationship_type = 'additional_charge'
    where child_item_id = 'bbbbbbbb-6666-6666-6666-666666666666';
    raise exception 'invalid cost attribution was accepted';
  exception when check_violation then null;
  end;
end;
$$;
select 'ok 4 - relationship type and cost attribution must agree';

reset role;
insert into public.items (id, user_id, management_type, service_name)
values ('cccccccc-7777-7777-7777-777777777777', '77777777-7777-7777-7777-777777777777', 'gifticon', 'Other user');
set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    insert into public.subscription_relationships (
      user_id, parent_item_id, child_item_id, relationship_type, cost_item_id
    ) values (
      '66666666-6666-6666-6666-666666666666',
      'aaaaaaaa-6666-6666-6666-666666666666',
      'cccccccc-7777-7777-7777-777777777777',
      'unknown_cost', null
    );
    raise exception 'cross-owner relationship was accepted';
  exception when others then
    if sqlerrm = 'cross-owner relationship was accepted' then raise; end if;
  end;
end;
$$;
select 'ok 5 - cross-owner relationships are rejected';

do $$
begin
  begin
    delete from public.items where id = 'aaaaaaaa-6666-6666-6666-666666666666';
    raise exception 'linked parent was deleted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select 'ok 6 - linked items cannot be deleted before detaching';

delete from public.subscription_relationships
where child_item_id = 'bbbbbbbb-6666-6666-6666-666666666666';
insert into public.subscription_relationships (
  user_id, parent_item_id, child_item_id, relationship_type, cost_item_id
) values (
  '66666666-6666-6666-6666-666666666666',
  'aaaaaaaa-6666-6666-6666-666666666666',
  'bbbbbbbb-6666-6666-6666-666666666666',
  'additional_charge',
  'bbbbbbbb-6666-6666-6666-666666666666'
);
select 'ok 7 - additional charges attribute cost to the child';

do $$
begin
  begin
    insert into public.subscription_relationships (
      user_id, parent_item_id, child_item_id, relationship_type, cost_item_id
    ) values (
      '66666666-6666-6666-6666-666666666666',
      'bbbbbbbb-6666-6666-6666-666666666666',
      'aaaaaaaa-6666-6666-6666-666666666666',
      'included_benefit',
      'bbbbbbbb-6666-6666-6666-666666666666'
    );
    raise exception 'relationship cycle was accepted';
  exception when others then
    if sqlerrm = 'relationship cycle was accepted' then raise; end if;
  end;
end;
$$;
select 'ok 8 - relationship cycles are rejected';

update public.items set amount = null, currency = null
where id = 'bbbbbbbb-6666-6666-6666-666666666666';
do $$
begin
  if exists (
    select 1 from public.item_price_periods
    where item_id = 'bbbbbbbb-6666-6666-6666-666666666666' and effective_to is null
  ) then
    raise exception 'unknown price left an open price period';
  end if;
end;
$$;
select 'ok 9 - changing a price to unknown closes its recorded period';

update public.items set actual_status = 'temporarily_paused'
where id = 'aaaaaaaa-6666-6666-6666-666666666666';
do $$ begin
  if not exists (select 1 from public.item_status_history where item_id='aaaaaaaa-6666-6666-6666-666666666666' and event_type='paused') then
    raise exception 'status history was not captured';
  end if;
end $$;
select 'ok 10 - status changes create user-owned history';

reset role;
insert into public.calendar_events(user_id,item_id,source_key,event_type,title,event_date,amount,currency)
values('66666666-6666-6666-6666-666666666666','aaaaaaaa-6666-6666-6666-666666666666','phase6:test','payment','test',current_date,10000,'KRW');
set local role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.set_calendar_event_schedule_status(id,'skipped') from public.calendar_events where source_key='phase6:test';
do $$ begin
  if not exists (select 1 from public.calendar_events where source_key='phase6:test' and schedule_status='skipped') then
    raise exception 'schedule status was not changed';
  end if;
end $$;
select 'ok 11 - owner can exclude a payment occurrence as skipped';

rollback;
