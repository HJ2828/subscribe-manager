alter table public.service_news
  add column if not exists source_country_code text
    check (source_country_code is null or source_country_code ~ '^[A-Z]{2}$'),
  add column if not exists source_language text;

update public.service_news
set title = left(title, 200),
    summary = left(summary, 200),
    impact_summary = case
      when impact_summary is null then null
      else left(impact_summary, 200)
    end;

alter table public.service_news
  drop constraint if exists service_news_title_length;
alter table public.service_news
  add constraint service_news_title_length check (length(title) between 1 and 200);
alter table public.service_news
  drop constraint if exists service_news_summary_length;
alter table public.service_news
  add constraint service_news_summary_length check (length(summary) between 1 and 200);
alter table public.service_news
  drop constraint if exists service_news_impact_length;
alter table public.service_news
  add constraint service_news_impact_length
  check (impact_summary is null or length(impact_summary) <= 200);

notify pgrst, 'reload schema';
