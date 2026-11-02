\set ON_ERROR_STOP on

begin;

select '1..7';

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'create_profile_after_signup' and not tgisinternal
  ) then
    raise exception 'new auth users must receive a profile';
  end if;
end;
$$;
select 'ok 1 - signup profile trigger exists';

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'phase2@example.test', '', now(), now());

do $$
begin
  if not exists (
    select 1 from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'
      and country_code = 'KR'
      and default_currency = 'KRW'
      and timezone = 'Asia/Seoul'
  ) then
    raise exception 'profile defaults are incorrect';
  end if;
end;
$$;
select 'ok 2 - new user receives Korean defaults';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.account_deletion_requests'::regclass) then
    raise exception 'account deletion requests must have RLS enabled';
  end if;
end;
$$;
select 'ok 3 - deletion request log has RLS enabled';

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform * from public.account_deletion_requests;
    raise exception 'authenticated user read server-only deletion log';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 4 - deletion log is server-only';

do $$
begin
  if public.get_my_storage_usage() <> 0 then
    raise exception 'new user storage usage must be zero';
  end if;
end;
$$;
select 'ok 5 - user storage usage starts at zero';

update public.profiles
set default_currency = 'USD', timezone = 'America/New_York'
where id = '33333333-3333-3333-3333-333333333333';
select case when count(*) = 1 then 'ok 6 - user can update own settings' else 'not ok 6' end
from public.profiles
where id = '33333333-3333-3333-3333-333333333333'
  and default_currency = 'USD'
  and timezone = 'America/New_York';

do $$
begin
  begin
    update public.profiles
    set notification_days_before = array[]::smallint[]
    where id = '33333333-3333-3333-3333-333333333333';
    raise exception 'empty notification defaults were accepted';
  exception
    when check_violation then null;
  end;
end;
$$;
select 'ok 7 - invalid notification defaults are rejected';

reset role;
rollback;
