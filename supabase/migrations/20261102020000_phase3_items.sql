alter table public.items
  add column if not exists management_type text not null default 'recurring_subscription',
  add column if not exists service_name text not null default '',
  add column if not exists plan_name text,
  add column if not exists amount numeric(12, 2),
  add column if not exists currency text,
  add column if not exists billing_cycle text,
  add column if not exists first_billing_date date,
  add column if not exists next_billing_date date,
  add column if not exists actual_status text not null default 'in_use',
  add column if not exists auto_renewal_status text not null default 'on',
  add column if not exists usage_plan text not null default 'scheduled',
  add column if not exists payment_method text,
  add column if not exists category text,
  add column if not exists memo text,
  add column if not exists reminder_days_before smallint[] not null default array[3, 0]::smallint[],
  add column if not exists reminder_time time not null default '09:00';

alter table public.items
  add constraint items_management_type_check
    check (management_type in (
      'recurring_subscription', 'fixed_term_membership', 'gifticon', 'coupon',
      'voucher', 'points', 'warranty', 'other_deadline'
    )),
  add constraint items_service_name_not_blank
    check (length(btrim(service_name)) between 1 and 120) not valid,
  add constraint items_amount_non_negative
    check (amount is null or amount >= 0),
  add constraint items_currency_format
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  add constraint items_billing_cycle_check
    check (billing_cycle is null or billing_cycle in ('monthly', 'yearly', 'custom')),
  add constraint items_actual_status_check
    check (actual_status in ('in_use', 'temporarily_paused', 'payment_issue', 'ended', 'needs_review')),
  add constraint items_auto_renewal_status_check
    check (auto_renewal_status in ('on', 'off', 'manual', 'needs_review')),
  add constraint items_usage_plan_check
    check (usage_plan in ('scheduled', 'ended', 'needs_review')),
  add constraint items_reminder_days_range
    check (cardinality(reminder_days_before) between 1 and 4 and reminder_days_before <@ array[0, 1, 3, 7, 14, 30]::smallint[]);

create index if not exists items_user_next_billing_idx
  on public.items(user_id, next_billing_date);

comment on column public.items.management_type is 'Phase 3 management form discriminator. Future item types extend this value.';
comment on column public.items.actual_status is 'Actual usage status, independent from automatic renewal and user plan.';
comment on column public.items.auto_renewal_status is 'Automatic renewal setting, independent from actual usage.';
comment on column public.items.usage_plan is 'User plan for future usage, independent from actual usage.';
