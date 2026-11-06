import { brandIconName, isPaymentScheduleType, type ManagedItem, type ManagementType } from "../phase3/model";
import { brandIconTone, type BrandIconTone } from "../brand/brand";

export type HomeEventKind = "payment" | "benefit";

export type HomeScheduleEvent = {
  key: string;
  itemId: string;
  kind: HomeEventKind;
  date: string;
  name: string;
  brandName?: string | null;
  brandDomain?: string | null;
  brandLogoUrl?: string | null;
  brandIconName?: string | null;
  brandIconTone?: BrandIconTone;
  brandIconEmoji?: string | null;
  managementType: ManagementType;
  providerName: string | null;
  planName: string | null;
  billingCycle: ManagedItem["billing_cycle"];
  amount: number | null;
  currency: string | null;
};

const BENEFIT_TYPES = new Set<ManagementType>([
  "gifticon",
  "coupon",
  "voucher",
  "points",
  "warranty",
  "other_deadline",
]);

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(value: string, days: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addAnchoredMonths(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const monthIndex = month - 1 + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function todayInTimeZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function recurringDates(item: ManagedItem, today: string, horizon: string) {
  const anchor = item.target_date_value || item.next_billing_date;
  const precision = item.target_date_value
    ? item.target_date_precision
    : item.next_billing_date
      ? "day"
      : null;
  if (!anchor || precision !== "day") return [];
  if (
    !["in_use", "payment_issue"].includes(item.actual_status) ||
    item.usage_plan === "ended"
  )
    return [];
  if (item.billing_cycle !== "monthly" && item.billing_cycle !== "yearly")
    return anchor >= today && anchor <= horizon ? [anchor] : [];

  const step = item.billing_cycle === "yearly" ? 12 : 1;
  const repeat = item.auto_renewal_status === "on";
  if (!repeat) return anchor >= today && anchor <= horizon ? [anchor] : [];
  const dates: string[] = [];
  for (let index = 0; index < 240; index += 1) {
    const date = addAnchoredMonths(anchor, index * step);
    if (date > horizon) break;
    if (date >= today) dates.push(date);
    if (!repeat && dates.length) break;
  }
  return dates;
}

export function buildHomeSchedule(
  items: ManagedItem[],
  today: string,
  horizonDays = 365,
) {
  const horizon = addDays(today, horizonDays);
  const events: HomeScheduleEvent[] = [];
  for (const item of items) {
    if (isPaymentScheduleType(item.management_type)) {
      for (const date of recurringDates(item, today, horizon)) {
        events.push({
          key: `${item.id}:payment:${date}`,
          itemId: item.id,
          kind: "payment",
          date,
          name: item.service_name,
          brandName: item.brand_name,
          brandDomain: item.brand_domain,
          brandLogoUrl: item.brand_logo_url,
          brandIconEmoji: item.brand_icon_emoji,
          brandIconName: brandIconName(item),
          brandIconTone: brandIconTone(item.management_type),
          managementType: item.management_type,
          providerName: item.provider_name,
          planName: item.plan_name,
          billingCycle: item.billing_cycle,
          amount: item.amount,
          currency: item.currency,
        });
      }
      continue;
    }
    if (
      BENEFIT_TYPES.has(item.management_type) &&
      !["used", "ended", "expired"].includes(item.lifecycle_status) &&
      item.target_date_value &&
      item.target_date_precision === "day" &&
      item.target_date_value >= today &&
      item.target_date_value <= horizon
    ) {
      events.push({
        key: `${item.id}:benefit:${item.target_date_value}`,
        itemId: item.id,
        kind: "benefit",
        date: item.target_date_value,
        name: item.service_name,
        brandName: item.brand_name,
        brandDomain: item.brand_domain,
        brandLogoUrl: item.brand_logo_url,
        brandIconEmoji: item.brand_icon_emoji,
        brandIconName: brandIconName(item),
        brandIconTone: brandIconTone(item.management_type),
        managementType: item.management_type,
        providerName: item.provider_name,
        planName: item.plan_name,
        billingCycle: item.billing_cycle,
        amount: item.amount,
        currency: item.currency,
      });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko"));
}

export function summarizeNext30Days(events: HomeScheduleEvent[], today: string) {
  const end = addDays(today, 29);
  const next30 = events.filter((event) => event.date >= today && event.date <= end);
  const payments = next30.filter((event) => event.kind === "payment");
  const benefits = next30.filter((event) => event.kind === "benefit");
  const totals: Record<string, number> = {};
  let excludedAmountCount = 0;
  for (const event of payments) {
    if (event.amount === null || !event.currency) {
      excludedAmountCount += 1;
      continue;
    }
    totals[event.currency] = (totals[event.currency] || 0) + event.amount;
  }
  return {
    end,
    paymentCount: payments.length,
    benefitCount: benefits.length,
    totals,
    excludedAmountCount,
  };
}

export function selectUpcomingEvents(
  events: HomeScheduleEvent[],
  filter: "all" | HomeEventKind,
  limit = 6,
) {
  const seenItems = new Set<string>();
  return events
    .filter((event) => filter === "all" || event.kind === filter)
    .filter((event) => {
      if (seenItems.has(event.itemId)) return false;
      seenItems.add(event.itemId);
      return true;
    })
    .slice(0, limit);
}

export function daysBetween(from: string, to: string) {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export function needsHomeReview(item: ManagedItem) {
  if (isPaymentScheduleType(item.management_type)) {
    return (
      !item.target_date_value ||
      item.target_date_precision !== "day" ||
      item.amount === null ||
      !item.currency
    );
  }
  return (
    BENEFIT_TYPES.has(item.management_type) &&
    (!item.target_date_value || item.target_date_precision !== "day")
  );
}
