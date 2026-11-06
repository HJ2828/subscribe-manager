alter table public.items
  add column if not exists brand_icon_emoji text;

comment on column public.items.brand_icon_emoji is 'User-selected emoji shown before resolved brand logos.';
