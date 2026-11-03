create table public.service_catalogs (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  match_names text[] not null default '{}',
  news_support_status text not null default 'collecting' check (news_support_status in ('management_only','collecting','needs_information','verifying','supported','unsupported')),
  cancellation_support_status text not null default 'collecting' check (cancellation_support_status in ('management_only','collecting','needs_information','verifying','supported','unsupported')),
  last_news_check_at timestamptz,
  last_cancellation_check_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index service_catalogs_display_name_ci_key on public.service_catalogs(lower(display_name));

create table public.cancellation_guides (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.service_catalogs(id) on delete cascade,
  payment_path text not null,
  country_code text not null default 'KR' check (country_code ~ '^[A-Z]{2}$'),
  plan_scope text,
  title text not null,
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  conditions text,
  access_after_cancel text,
  source_title text not null,
  source_url text not null,
  source_domain text not null,
  checked_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft','pending_review','published','recheck_required','hidden')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index cancellation_guides_catalog_status_idx on public.cancellation_guides(catalog_id, status, payment_path, country_code);

create table public.service_news (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.service_catalogs(id) on delete cascade,
  news_type text not null check (news_type in ('content','feature','limit','price','benefit','ending','other')),
  title text not null,
  summary text not null,
  source_title text not null,
  source_url text not null,
  source_domain text not null,
  source_country_code text check (source_country_code is null or source_country_code ~ '^[A-Z]{2}$'),
  source_language text,
  announced_on date,
  applies_on date,
  country_codes text[] not null default '{}',
  plan_scopes text[] not null default '{}',
  conditions text,
  impact_summary text,
  applicability_status text not null default 'needs_confirmation' check (applicability_status in ('confirmed','needs_confirmation')),
  checked_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft','pending_review','published','hidden')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.service_news
  add constraint service_news_title_length check (length(title) between 1 and 200),
  add constraint service_news_summary_length check (length(summary) between 1 and 200),
  add constraint service_news_impact_length check (impact_summary is null or length(impact_summary) <= 200);

create index service_news_catalog_status_idx on public.service_news(catalog_id, status, applies_on desc, announced_on desc);

create table public.content_collection_runs (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid references public.service_catalogs(id) on delete cascade,
  content_kind text not null check (content_kind in ('news','cancellation')),
  outcome text not null check (outcome in ('new_content','no_new_content','search_failed','source_failed','conditions_unconfirmed','budget_limited')),
  checked_at timestamptz not null default timezone('utc', now()),
  details text,
  estimated_cost_usd numeric(10, 4) not null default 0 check (estimated_cost_usd >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.operator_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null check (length(btrim(body)) between 1 and 5000),
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index operator_announcements_status_date_idx on public.operator_announcements(status, published_at desc);

create table public.content_review_audit (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid references auth.users(id) on delete set null,
  entity_type text not null check (entity_type in ('catalog','cancellation_guide','news','collection_run','announcement')),
  entity_id uuid not null,
  action text not null,
  reason text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index content_review_audit_entity_idx on public.content_review_audit(entity_type, entity_id, created_at desc);

alter table public.service_catalogs enable row level security;
alter table public.cancellation_guides enable row level security;
alter table public.service_news enable row level security;
alter table public.content_collection_runs enable row level security;
alter table public.content_review_audit enable row level security;
alter table public.operator_announcements enable row level security;

revoke all on table public.service_catalogs, public.cancellation_guides, public.service_news, public.content_collection_runs, public.content_review_audit, public.operator_announcements from anon, authenticated;

comment on table public.service_catalogs is 'Phase 8 shared support catalog. Access is mediated by the backend.';
comment on table public.cancellation_guides is 'Official-source cancellation instructions separated by payment path and country.';
comment on table public.service_news is 'Shared official-source service news, never generated per user refresh.';
comment on table public.content_review_audit is 'Immutable operator review history with before and after snapshots.';
comment on table public.operator_announcements is 'Operator-authored notices visible to all users only after publication.';
