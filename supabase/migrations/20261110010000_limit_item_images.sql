create or replace function private.enforce_item_image_limit()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  linked_count integer;
begin
  if new.item_id is null
     or new.lifecycle_status <> 'active'
     or new.original_status <> 'kept' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text, 0));

  select count(*)::integer
    into linked_count
    from public.image_assets
   where item_id = new.item_id
     and lifecycle_status = 'active'
     and original_status = 'kept'
     and id <> new.id;

  if linked_count >= 3 then
    raise exception using
      errcode = 'check_violation',
      message = 'An item can have at most 3 active kept images.';
  end if;

  return new;
end;
$$;

drop trigger if exists image_assets_enforce_item_limit on public.image_assets;
create trigger image_assets_enforce_item_limit
before insert or update of item_id, lifecycle_status, original_status on public.image_assets
for each row execute function private.enforce_item_image_limit();

create or replace function public.assert_my_storage_capacity(p_size_bytes bigint)
returns void
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  if p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception using
      errcode = 'check_violation',
      message = 'image_size_invalid';
  end if;

  if public.get_my_storage_usage() + p_size_bytes > 262144000 then
    raise exception using
      errcode = 'check_violation',
      message = 'storage_quota_exceeded';
  end if;
end;
$$;

revoke all on function public.assert_my_storage_capacity(bigint) from public, anon;
grant execute on function public.assert_my_storage_capacity(bigint) to authenticated;

create or replace function private.enforce_user_storage_limit()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if public.get_my_storage_usage() > 262144000 then
    raise exception using
      errcode = 'check_violation',
      message = 'storage_quota_exceeded';
  end if;
  return new;
end;
$$;

drop trigger if exists image_assets_enforce_user_storage_limit on public.image_assets;
create trigger image_assets_enforce_user_storage_limit
before insert on public.image_assets
for each row execute function private.enforce_user_storage_limit();
