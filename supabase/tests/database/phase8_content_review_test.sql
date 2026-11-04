begin;
select '1..13';

select ok((select relrowsecurity from pg_class where oid='public.service_catalogs'::regclass), 'catalog RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.cancellation_guides'::regclass), 'guide RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.service_news'::regclass), 'news RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.operator_announcements'::regclass), 'announcement RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.user_news_scraps'::regclass), 'scrap RLS enabled');
select ok(to_regprocedure('public.claim_content_collection_job(uuid,integer,numeric,numeric,numeric,integer)') is not null, 'atomic content job claim exists');
select ok(to_regprocedure('public.cleanup_old_service_news()') is not null, 'news retention cleanup exists');

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'phase8-a@example.test', '', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'phase8-b@example.test', '', now(), now());
insert into public.service_catalogs(id, display_name) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Phase8 test');
insert into public.service_news(id, catalog_id, news_type, title, summary, source_title, source_url, source_domain, announced_on, checked_at, status)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'price', 'price', 'summary', 'official', 'https://official.example/news', 'official.example', current_date, now(), 'published');
insert into public.service_news(id, catalog_id, news_type, title, summary, source_title, source_url, source_domain, announced_on, checked_at, status)
values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'content', 'old un-scrapped', 'summary', 'official', 'https://official.example/old-1', 'official.example', current_date - 800, now(), 'published'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'content', 'old scrapped', 'summary', 'official', 'https://official.example/old-2', 'official.example', current_date - 800, now(), 'published');
insert into public.user_news_scraps(user_id, news_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

do $$ begin perform * from public.cleanup_old_service_news(); end $$;
select is((select count(*) from public.service_news where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 0::bigint, 'un-scrapped old news is deleted');
select is((select status from public.service_news where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), 'archived', 'scrapped old news is archived and retained');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($$ select * from public.service_news $$, '42501', null, 'authenticated clients cannot read shared drafts directly');
select throws_ok($$ insert into public.service_catalogs(display_name) values ('unsafe') $$, '42501', null, 'authenticated clients cannot create catalog content');
select is((select count(*) from public.user_news_scraps), 2::bigint, 'users only read their own scraps');
delete from public.user_news_scraps where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select is((select count(*) from public.user_news_scraps), 2::bigint, 'users cannot delete another user scrap');
rollback;
