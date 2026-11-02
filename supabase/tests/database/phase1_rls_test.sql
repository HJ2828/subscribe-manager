\set ON_ERROR_STOP on

begin;

select '1..13';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'profiles must have RLS enabled';
  end if;
end;
$$;
select 'ok 1 - profiles has RLS enabled';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.items'::regclass) then
    raise exception 'items must have RLS enabled';
  end if;
end;
$$;
select 'ok 2 - items has RLS enabled';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.services'::regclass) then
    raise exception 'services must have RLS enabled';
  end if;
end;
$$;
select 'ok 3 - services has RLS enabled';

do $$
begin
  if (select public from storage.buckets where id = 'user-images') is distinct from false then
    raise exception 'user-images bucket must be private';
  end if;
end;
$$;
select 'ok 4 - user-images bucket is private';

do $$
begin
  if (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'user_images_%'
  ) <> 4 then
    raise exception 'user-images must have four operation-specific policies';
  end if;
end;
$$;
select 'ok 5 - user-images has four operation-specific policies';

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'user-a@example.test', '', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'user-b@example.test', '', now(), now());

insert into public.profiles (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.items (id, user_id, service_name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'User A item'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'User B item');

insert into public.services (slug, name) values ('shared-service', 'Shared service');

insert into storage.objects (bucket_id, name, owner_id) values
  ('user-images', '11111111-1111-1111-1111-111111111111/a.png', '11111111-1111-1111-1111-111111111111'),
  ('user-images', '22222222-2222-2222-2222-222222222222/b.png', '22222222-2222-2222-2222-222222222222');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  if (select count(*) from public.items) <> 1 then
    raise exception 'user A must see only their item';
  end if;
end;
$$;
select 'ok 6 - user A sees only their item';

do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'user A must see only their profile';
  end if;
end;
$$;
select 'ok 7 - user A sees only their profile';

do $$
declare
  affected integer;
begin
  update public.items
  set updated_at = now()
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'user A updated user B item';
  end if;
end;
$$;
select 'ok 8 - user A cannot update user B item';

do $$
begin
  begin
    insert into public.items (user_id)
    values ('22222222-2222-2222-2222-222222222222');
    raise exception 'user A created an item for user B';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 9 - user A cannot create an item for user B';

do $$
begin
  if (select count(*) from public.services) <> 1 then
    raise exception 'authenticated user must read common services';
  end if;
end;
$$;
select 'ok 10 - authenticated users can read common services';

do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'user-images') <> 1 then
    raise exception 'user A must see only their image object';
  end if;
end;
$$;
select 'ok 11 - user A sees only their image objects';

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'user-images',
      '22222222-2222-2222-2222-222222222222/forbidden.png',
      '11111111-1111-1111-1111-111111111111'
    );
    raise exception 'user A created an image in user B path';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 12 - user A cannot create an image in user B path';

reset role;
set local role anon;

do $$
begin
  begin
    perform * from public.items;
    raise exception 'anonymous user read protected items';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 13 - anonymous users cannot read items';

reset role;
rollback;
