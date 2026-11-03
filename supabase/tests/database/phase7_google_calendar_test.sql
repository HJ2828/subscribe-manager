\set ON_ERROR_STOP on

begin;

select '1..5';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.google_calendar_connections'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.google_calendar_event_mappings'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.google_oauth_states'::regclass) then
    raise exception 'Phase 7 tables must have RLS enabled';
  end if;
end;
$$;
select 'ok 1 - Google Calendar tables have RLS enabled';

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('88888888-8888-8888-8888-888888888888', 'authenticated', 'authenticated', 'phase7-a@example.test', '', now(), now()),
  ('99999999-9999-9999-9999-999999999999', 'authenticated', 'authenticated', 'phase7-b@example.test', '', now(), now());

insert into public.google_calendar_connections (user_id, google_calendar_id, status)
values
  ('88888888-8888-8888-8888-888888888888', 'calendar-a', 'connected'),
  ('99999999-9999-9999-9999-999999999999', 'calendar-b', 'connected');

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform * from public.google_calendar_connections;
    raise exception 'authenticated user read server-managed tokens';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 2 - connection tokens remain server-only';

reset role;
do $$
begin
  begin
    update public.google_calendar_connections
    set selected_event_types = array['unknown']
    where user_id = '88888888-8888-8888-8888-888888888888';
    raise exception 'invalid event type was accepted';
  exception when check_violation then null;
  end;
end;
$$;
select 'ok 3 - export event types are constrained';

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform * from public.google_oauth_states;
    raise exception 'OAuth states are visible to authenticated users';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 4 - OAuth states are server-only';

do $$
begin
  begin
    insert into public.google_calendar_event_mappings(
      user_id, source_key, google_calendar_id, google_event_id
    ) values (
      '88888888-8888-8888-8888-888888888888', 'source', 'calendar-a', 'event-a'
    );
    raise exception 'authenticated user wrote a Google event mapping';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 5 - event mappings remain server-only';

rollback;
