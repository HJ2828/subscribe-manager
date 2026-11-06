alter table public.service_catalogs
  add column if not exists collection_enabled boolean not null default true;

create table if not exists public.content_collection_settings (
  id integer primary key default 1 check (id = 1),
  collection_enabled boolean not null default true,
  interval_hours integer not null default 72 check (interval_hours between 1 and 720),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.content_collection_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.content_collection_settings enable row level security;
revoke all on table public.content_collection_settings from anon, authenticated;

comment on column public.service_catalogs.collection_enabled is
  'Operator switch for automatic news collection. Does not delete the catalog or existing news.';

comment on table public.content_collection_settings is
  'Singleton operator controls for the shared automatic content collection job.';

notify pgrst, 'reload schema';
