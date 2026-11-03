create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_calendar_id text,
  calendar_name text not null default 'subscribe-manager',
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  granted_scope text,
  selected_event_types text[] not null default array['payment','renewal','cancellation','review','expiry','warranty'],
  status text not null default 'disconnected' check (status in ('connected','reauth_required','sync_delayed','disconnected')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (selected_event_types <@ array['payment','renewal','cancellation','review','expiry','warranty']::text[])
);

create table public.google_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.google_calendar_event_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_event_id uuid references public.calendar_events(id) on delete set null,
  source_key text not null,
  google_calendar_id text not null,
  google_event_id text not null,
  sync_status text not null default 'synced' check (sync_status in ('synced','pending','failed','delete_failed')),
  synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, source_key),
  unique (user_id, google_calendar_id, google_event_id)
);

create index google_calendar_mappings_user_event_idx
  on public.google_calendar_event_mappings(user_id, calendar_event_id);

create trigger google_calendar_connections_set_updated_at before update on public.google_calendar_connections
for each row execute function private.set_updated_at();
create trigger google_calendar_mappings_set_updated_at before update on public.google_calendar_event_mappings
for each row execute function private.set_updated_at();

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_event_mappings enable row level security;
alter table public.google_oauth_states enable row level security;

revoke all on table public.google_calendar_connections, public.google_calendar_event_mappings, public.google_oauth_states from anon, authenticated;

create policy "google_calendar_connections_select_own" on public.google_calendar_connections
for select to authenticated using ((select auth.uid()) = user_id);
create policy "google_calendar_mappings_select_own" on public.google_calendar_event_mappings
for select to authenticated using ((select auth.uid()) = user_id);

comment on table public.google_calendar_connections is
  'Phase 7 server-managed Google Calendar OAuth connection. Tokens are encrypted before storage.';
comment on table public.google_calendar_event_mappings is
  'One-way mapping from internal calendar source keys to app-created Google events.';
