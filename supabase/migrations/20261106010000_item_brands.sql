alter table public.items
  add column if not exists brand_name text,
  add column if not exists brand_domain text,
  add column if not exists brand_logo_url text;

comment on column public.items.brand_name is 'Matched brand label; does not replace the user-entered service_name.';
comment on column public.items.brand_domain is 'Brandfetch domain selected for the item brand.';
comment on column public.items.brand_logo_url is 'Resolved Brandfetch logo URL for the selected domain.';
