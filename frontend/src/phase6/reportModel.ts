import { isPaymentScheduleType, type ManagedItem } from "../phase3/model";

export type RelationshipType = "included_benefit" | "additional_charge" | "unknown_cost";

export type SubscriptionRelationship = {
  id: string;
  user_id: string;
  parent_item_id: string;
  child_item_id: string;
  relationship_type: RelationshipType;
  cost_item_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportEvent = {
  id: string;
  item_id: string;
  event_type: string;
  event_date: string;
  amount: number | null;
  currency: string | null;
  schedule_status?: "scheduled" | "cancelled" | "skipped";
};

export type PricePeriod = {
  item_id: string;
  amount: number;
  currency: string;
  billing_cycle: "monthly" | "yearly";
  effective_from: string;
  effective_to: string | null;
};
export type ItemStatusHistory = { id:string; item_id:string; event_type:"tracking_started"|"paused"|"ended"|"resumed"|"status_changed"; previous_status:string|null; current_status:string; occurred_on:string };

export type ReportMetricRow = {
  item: ManagedItem;
  relationship: SubscriptionRelationship | null;
  monthlyEquivalent: number | null;
  estimatedAccumulated: number | null;
  subscribedMonths: number | null;
  includedInCost: boolean;
};

export type ReportSummary = {
  totalByCurrency: Record<string, number>;
  remainingByCurrency: Record<string, number>;
  missingAmountCount: number;
  cancelledCount: number;
  duplicateExcludedCount: number;
  hasPastSchedules: boolean;
};

export type MonthlyReportPoint = {
  month: string;
  past: number;
  future: number;
  total: number;
  count: number;
};

function dayNumber(value: string) {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000;
}

export function monthsBetween(start: string | null, end: string) {
  if (!start || start.length !== 10 || start > end) return null;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const whole = (ey - sy) * 12 + em - sm;
  return Math.max(0, whole + (ed - sd) / 30.4375);
}

export function monthlyEquivalent(item: ManagedItem) {
  if (item.amount === null || !item.currency) return null;
  if (item.billing_cycle === "monthly") return item.amount;
  if (item.billing_cycle === "yearly") return item.amount / 12;
  return null;
}

function relationMap(relations: SubscriptionRelationship[]) {
  return new Map(relations.map((relation) => [relation.child_item_id, relation]));
}

export function isCostAttributedToItem(
  itemId: string,
  relations: SubscriptionRelationship[],
) {
  const relation = relationMap(relations).get(itemId);
  return !relation || relation.cost_item_id === itemId;
}

export function summarizeReport(
  events: ReportEvent[],
  relations: SubscriptionRelationship[],
  start: string,
  end: string,
  today: string,
): ReportSummary {
  const totalByCurrency: Record<string, number> = {};
  const remainingByCurrency: Record<string, number> = {};
  let missingAmountCount = 0;
  let cancelledCount = 0;
  let duplicateExcludedCount = 0;
  let hasPastSchedules = false;
  for (const event of events) {
    if (event.event_type !== "payment" || event.event_date < start || event.event_date > end) continue;
    if (event.event_date < today) hasPastSchedules = true;
    if (event.schedule_status === "cancelled" || event.schedule_status === "skipped") {
      cancelledCount += 1;
      continue;
    }
    if (!isCostAttributedToItem(event.item_id, relations)) {
      duplicateExcludedCount += 1;
      continue;
    }
    if (event.amount === null || !event.currency) {
      missingAmountCount += 1;
      continue;
    }
    totalByCurrency[event.currency] = (totalByCurrency[event.currency] || 0) + event.amount;
    // Phase 6 policy: a schedule due today is still part of the remaining estimate.
    if (event.event_date >= today)
      remainingByCurrency[event.currency] = (remainingByCurrency[event.currency] || 0) + event.amount;
  }
  return {
    totalByCurrency,
    remainingByCurrency,
    missingAmountCount,
    cancelledCount,
    duplicateExcludedCount,
    hasPastSchedules,
  };
}

export function buildMonthlyBreakdown(
  events: ReportEvent[],
  relations: SubscriptionRelationship[],
  start: string,
  end: string,
  today: string,
  currency: string,
) {
  const months: MonthlyReportPoint[] = [];
  let cursor = start.slice(0, 7);
  const last = end.slice(0, 7);
  for (let index = 0; cursor <= last && index < 2400; index += 1) {
    months.push({ month: cursor, past: 0, future: 0, total: 0, count: 0 });
    const [year, month] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(year, month, 1));
    cursor = next.toISOString().slice(0, 7);
  }
  const byMonth = new Map(months.map((point) => [point.month, point]));
  for (const event of events) {
    if (
      event.event_type !== "payment" || event.event_date < start || event.event_date > end ||
      event.currency !== currency || event.amount === null ||
      event.schedule_status === "cancelled" || event.schedule_status === "skipped" ||
      !isCostAttributedToItem(event.item_id, relations)
    ) continue;
    const point = byMonth.get(event.event_date.slice(0, 7));
    if (!point) continue;
    if (event.event_date < today) point.past += event.amount;
    else point.future += event.amount;
    point.total += event.amount;
    point.count += 1;
  }
  return months;
}

export function accumulatedFromPricePeriods(
  periods: PricePeriod[],
  itemId: string,
  currency: string,
  today: string,
) {
  const relevant = periods.filter(
    (period) =>
      period.item_id === itemId &&
      period.currency === currency &&
      period.effective_from <= today,
  );
  if (!relevant.length) return null;
  return relevant.reduce((sum, period) => {
    const end = period.effective_to && period.effective_to < today ? period.effective_to : today;
    if (end < period.effective_from) return sum;
    const days = dayNumber(end) - dayNumber(period.effective_from) + 1;
    const daily = period.billing_cycle === "yearly" ? period.amount / 365.2425 : period.amount / 30.4375;
    return sum + daily * days;
  }, 0);
}

export function buildMetricRows(
  items: ManagedItem[],
  relations: SubscriptionRelationship[],
  periods: PricePeriod[],
  currency: string,
  today: string,
) {
  const byChild = relationMap(relations);
  return items
    .filter((item) => isPaymentScheduleType(item.management_type) || byChild.has(item.id))
    .map((item): ReportMetricRow => {
      const relationship = byChild.get(item.id) || null;
      const includedInCost = !relationship || relationship.cost_item_id === item.id;
      const matchingCurrency = item.currency === currency;
      return {
        item,
        relationship,
        includedInCost,
        monthlyEquivalent:
          includedInCost && matchingCurrency ? monthlyEquivalent(item) : null,
        estimatedAccumulated:
          includedInCost && matchingCurrency
            ? accumulatedFromPricePeriods(periods, item.id, currency, today)
            : null,
        subscribedMonths: monthsBetween(item.start_date_value, today),
      };
    });
}

export function metricValue(
  row: ReportMetricRow,
  metric: "monthly" | "accumulated" | "months",
) {
  return metric === "monthly"
    ? row.monthlyEquivalent
    : metric === "accumulated"
      ? row.estimatedAccumulated
      : row.subscribedMonths;
}
