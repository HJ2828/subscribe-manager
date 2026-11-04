import { isPaymentScheduleType, type ManagedItem, type ManagementType } from "../phase3/model";
import { addDays, buildHomeSchedule } from "../home/homeModel";

export type CalendarEventKind =
  | "payment"
  | "renewal"
  | "cancellation"
  | "review"
  | "expiry"
  | "warranty";

export type CalendarEvent = {
  key: string;
  itemId: string;
  kind: CalendarEventKind;
  date: string;
  name: string;
  managementType: ManagementType;
  amount: number | null;
  currency: string | null;
};

export const CALENDAR_KIND_LABELS: Record<CalendarEventKind, string> = {
  payment: "결제",
  renewal: "갱신",
  cancellation: "해지 마감",
  review: "검토",
  expiry: "기한 만료",
  warranty: "보장 종료",
};

export const CALENDAR_KIND_GROUPS = [
  { key: "billing", label: "결제·갱신", kinds: ["payment", "renewal"] },
  { key: "decision", label: "해지·검토", kinds: ["cancellation", "review"] },
  { key: "ending", label: "만료·보장 종료", kinds: ["expiry", "warranty"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; kinds: readonly CalendarEventKind[] }>;

const BENEFIT_TYPES = new Set<ManagementType>(["gifticon", "coupon", "voucher", "points"]);

export function buildCalendarEvents(items: ManagedItem[], from: string, to: string) {
  const horizonDays = Math.max(0, Math.ceil((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
  const homeEvents = buildHomeSchedule(items, from, horizonDays);
  const events: CalendarEvent[] = homeEvents.map((event) => ({
    key: event.key,
    itemId: event.itemId,
    kind: event.kind === "payment" ? "payment" : "expiry",
    date: event.date,
    name: event.name,
    managementType: event.managementType,
    amount: event.amount,
    currency: event.currency,
  }));

  for (const item of items) {
    if (
      isPaymentScheduleType(item.management_type) ||
      BENEFIT_TYPES.has(item.management_type) ||
      !item.target_date_value ||
      item.target_date_precision !== "day" ||
      item.target_date_value < from ||
      item.target_date_value > to ||
      ["used", "ended", "expired"].includes(item.lifecycle_status)
    ) continue;

    const kind: CalendarEventKind = item.management_type === "fixed_term_membership"
      ? item.auto_renewal_status === "on" ? "renewal" : "expiry"
      : item.management_type === "warranty" ? "warranty" : "review";
    events.push({
      key: `${item.id}:${kind}:${item.target_date_value}`,
      itemId: item.id,
      kind,
      date: item.target_date_value,
      name: item.service_name,
      managementType: item.management_type,
      amount: null,
      currency: null,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko"));
}

export function monthGrid(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, monthNumber - 1, 1 - leading)).toISOString().slice(0, 10);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function weekDates(anchor: string) {
  const date = new Date(`${anchor}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  const start = addDays(anchor, -offset);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function filterCalendarEvents(events: CalendarEvent[], kinds: Set<CalendarEventKind>) {
  return events.filter((event) => kinds.has(event.kind));
}
