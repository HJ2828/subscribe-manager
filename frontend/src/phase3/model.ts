export type ManagementType =
  | "recurring_subscription"
  | "other_payment_deadline"
  | "fixed_term_membership"
  | "gifticon"
  | "coupon"
  | "voucher"
  | "points"
  | "warranty"
  | "other_deadline";

export type DatePrecision = "day" | "month";
export type LifecycleStatus =
  | "active"
  | "unused"
  | "used"
  | "ended"
  | "expired"
  | "needs_review";
export type SupportScope = "none" | "news" | "cancellation" | "both";

export type ManagedItem = {
  id: string;
  user_id: string;
  management_type: ManagementType;
  service_name: string;
  brand_name: string | null;
  brand_domain: string | null;
  brand_logo_url: string | null;
  brand_icon_emoji: string | null;
  plan_name: string | null;
  provider_name: string | null;
  amount: number | null;
  currency: string | null;
  unit_name: string | null;
  billing_cycle: "monthly" | "yearly" | "custom" | null;
  start_date_value: string | null;
  start_date_precision: DatePrecision | null;
  target_date_value: string | null;
  target_date_precision: DatePrecision | null;
  first_billing_date: string | null;
  next_billing_date: string | null;
  conditions: string | null;
  lifecycle_status: LifecycleStatus;
  actual_status:
    | "in_use"
    | "temporarily_paused"
    | "payment_issue"
    | "ended"
    | "needs_review";
  auto_renewal_status: "on" | "off" | "manual" | "needs_review";
  usage_plan: "scheduled" | "ended" | "needs_review";
  payment_method: string | null;
  category: string | null;
  memo: string | null;
  support_scope: SupportScope;
  completed_at: string | null;
  reminder_days_before: number[];
  reminder_time: string;
  created_at: string;
  updated_at: string;
};

export type ManagedItemDraft = Omit<
  ManagedItem,
  "id" | "user_id" | "created_at" | "updated_at" | "completed_at"
>;

export type ManagedItemPayload = ManagedItemDraft & {
  user_id: string;
};

const USAGE_BRAND_TYPES = new Set<ManagementType>(["gifticon", "coupon", "voucher", "points"]);

export function brandIconName(item: Pick<ManagedItem, "management_type" | "service_name" | "provider_name">) {
  if (USAGE_BRAND_TYPES.has(item.management_type) && item.provider_name?.trim()) {
    return item.provider_name.trim();
  }
  return item.service_name;
}

export const TYPE_OPTIONS: Array<{
  value: ManagementType;
  label: string;
  shortLabel: string;
}> = [
  {
    value: "recurring_subscription",
    label: "반복 결제 구독",
    shortLabel: "반복 구독",
  },
  {
    value: "fixed_term_membership",
    label: "기한제 구독·멤버십",
    shortLabel: "기한제 멤버십",
  },
  { value: "gifticon", label: "기프티콘", shortLabel: "기프티콘" },
  { value: "coupon", label: "쿠폰", shortLabel: "쿠폰" },
  { value: "voucher", label: "상품권", shortLabel: "상품권" },
  { value: "points", label: "포인트", shortLabel: "포인트" },
  {
    value: "warranty",
    label: "제품 보증·보장 서비스",
    shortLabel: "제품 보증",
  },
  {
    value: "other_payment_deadline",
    label: "기타 결제 기한",
    shortLabel: "기타 결제 기한",
  },
  { value: "other_deadline", label: "기타 기한", shortLabel: "기타 기한" },
];

export const CATEGORY_OPTIONS = [
  "영상·콘텐츠·OTT",
  "AI·생산성",
  "디자인·소프트웨어",
  "음악·오디오",
  "독서·교육",
  "게임",
  "쇼핑·배달",
  "식품·카페·외식",
  "정기배송",
  "가전·생활관리",
  "통신·클라우드",
  "건강·운동",
  "라이프·기록",
  "기타",
] as const;

export function typeLabel(value: ManagementType, short = false) {
  const option = TYPE_OPTIONS.find((candidate) => candidate.value === value);
  return (short ? option?.shortLabel : option?.label) || "관리 항목";
}

export function isPaymentScheduleType(type: ManagementType) {
  return type === "recurring_subscription" || type === "other_payment_deadline";
}

function defaultLifecycleStatus(type: ManagementType): LifecycleStatus {
  return type === "gifticon" || type === "coupon" || type === "voucher"
    ? "unused"
    : "active";
}

export function createEmptyDraft(
  type: ManagementType = "recurring_subscription",
): ManagedItemDraft {
  return {
    management_type: type,
    service_name: "",
    brand_name: null,
    brand_domain: null,
    brand_logo_url: null,
    brand_icon_emoji: null,
    plan_name: "",
    provider_name: "",
    amount: null,
    currency: isMoneyType(type) ? "KRW" : null,
    unit_name: type === "points" ? "P" : null,
    billing_cycle: isPaymentScheduleType(type) ? "monthly" : null,
    start_date_value: null,
    start_date_precision: "day",
    target_date_value: null,
    target_date_precision: "day",
    first_billing_date: null,
    next_billing_date: null,
    conditions: "",
    lifecycle_status: defaultLifecycleStatus(type),
    actual_status: "in_use",
    auto_renewal_status:
      isPaymentScheduleType(type) || type === "fixed_term_membership"
        ? "on"
        : "needs_review",
    usage_plan:
      isPaymentScheduleType(type) ? "scheduled" : "needs_review",
    payment_method: "",
    category: "",
    memo: "",
    support_scope: "none",
    reminder_days_before: [3, 0],
    reminder_time: "09:00",
  };
}

export function dateInputType(precision: DatePrecision | null) {
  return precision === "month" ? "month" : "date";
}

export function validDateValue(
  value: string | null,
  precision: DatePrecision | null,
) {
  if (!value) return true;
  if (precision === "month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function displayDate(
  value: string | null,
  precision: DatePrecision | null,
) {
  if (!value) return "날짜 확인 필요";
  if (precision === "month") {
    const [year, month] = value.split("-");
    return `${year}년 ${Number(month)}월`;
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "날짜 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\.$/, "");
}

export type DdayTone = "normal" | "soon" | "urgent" | "ended";

export function isPastDate(
  value: string | null,
  precision: DatePrecision | null,
  now = new Date(),
) {
  if (!value || !precision || !validDateValue(value, precision)) return false;
  if (precision === "month") {
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return value < currentMonth;
  }
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function formatDday(
  value: string | null,
  precision: DatePrecision | null,
  now = new Date(),
): { label: string; tone: DdayTone } | null {
  if (!value || precision !== "day" || !validDateValue(value, precision)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const difference = Math.round((target - today) / 86_400_000);

  if (difference < 0) return { label: `D+${Math.abs(difference)}`, tone: "ended" };
  if (difference === 0) return { label: "D-day", tone: "urgent" };
  if (difference <= 3) return { label: `D-${difference}`, tone: "urgent" };
  if (difference <= 7) return { label: `D-${difference}`, tone: "soon" };
  return { label: `D-${difference}`, tone: "normal" };
}

function anchoredDate(year: number, monthIndex: number, anchorDay: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(anchorDay, lastDay)));
}

export function proposeNextRecurringDate(
  startValue: string | null,
  startPrecision: DatePrecision | null,
  cycle: ManagedItemDraft["billing_cycle"],
  now = new Date(),
) {
  if (
    !startValue ||
    startPrecision !== "day" ||
    (cycle !== "monthly" && cycle !== "yearly")
  )
    return null;
  const [year, month, day] = startValue.split("-").map(Number);
  if (!year || !month || !day) return null;
  const anchorMonth = month - 1;
  let candidate = anchoredDate(year, anchorMonth, day);
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  let step = 0;
  while (candidate < today && step < 2400) {
    step += 1;
    const months = cycle === "yearly" ? step * 12 : step;
    const totalMonth = anchorMonth + months;
    candidate = anchoredDate(
      year + Math.floor(totalMonth / 12),
      ((totalMonth % 12) + 12) % 12,
      day,
    );
  }
  if (step >= 2400) return null;
  return candidate.toISOString().slice(0, 10);
}

export function rollForwardRecurringItem(
  item: ManagedItem,
  today: string,
): ManagedItem {
  if (
    !isPaymentScheduleType(item.management_type) ||
    item.auto_renewal_status !== "on" ||
    (item.billing_cycle !== "monthly" && item.billing_cycle !== "yearly") ||
    !["in_use", "payment_issue"].includes(item.actual_status) ||
    item.usage_plan === "ended"
  )
    return item;

  const current = item.target_date_value || item.next_billing_date;
  const precision = item.target_date_value
    ? item.target_date_precision
    : item.next_billing_date
      ? "day"
      : null;
  if (!current || precision !== "day" || current >= today) return item;

  let anchor = current;
  if (item.first_billing_date && validDateValue(item.first_billing_date, "day")) {
    const currentParts = current.split("-").map(Number);
    const firstParts = item.first_billing_date.split("-").map(Number);
    const currentLastDay = new Date(Date.UTC(currentParts[0], currentParts[1], 0)).getUTCDate();
    if (currentParts[2] === currentLastDay && firstParts[2] > currentParts[2]) {
      anchor = item.first_billing_date;
    }
  }

  const next = proposeNextRecurringDate(anchor, "day", item.billing_cycle, new Date(`${today}T12:00:00`));
  if (!next || next === current) return item;
  return {
    ...item,
    target_date_value: next,
    target_date_precision: "day",
    next_billing_date: next,
  };
}

export function targetSortValue(item: ManagedItem) {
  return item.target_date_value || item.next_billing_date || "9999-12-31";
}

export function isMoneyType(type: ManagementType) {
  return !["points", "warranty", "other_deadline"].includes(type);
}

export function canMarkUsed(type: ManagementType) {
  return type === "gifticon" || type === "coupon" || type === "voucher" || type === "points";
}

export function isTargetDateExpired(
  value: string | null,
  precision: DatePrecision | null,
  now = new Date(),
) {
  if (!value || !precision || !validDateValue(value, precision)) return false;
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const today = `${year}-${month}-${day}`;
  return precision === "month" ? value < today.slice(0, 7) : value < today;
}

export function itemStatusValue(
  item: Pick<
    ManagedItem,
    | "management_type"
    | "actual_status"
    | "lifecycle_status"
    | "target_date_value"
    | "target_date_precision"
  >,
  now = new Date(),
) {
  if (isPaymentScheduleType(item.management_type)) return item.actual_status;
  return isTargetDateExpired(
    item.target_date_value,
    item.target_date_precision,
    now,
  )
    ? "expired"
    : item.lifecycle_status;
}

export function validateManagedItemDraft(draft: ManagedItemDraft) {
  const errors: Record<string, string> = {};
  if (!draft.service_name.trim())
    errors.service_name = `${draft.management_type === "warranty" ? "제품명" : draft.management_type === "other_payment_deadline" ? "결제 이름" : draft.management_type === "recurring_subscription" || draft.management_type === "fixed_term_membership" || draft.management_type === "points" ? "서비스명" : "이름"}을 확인해 주세요.`;
  if (
    draft.amount !== null &&
    (!Number.isFinite(draft.amount) || draft.amount < 0)
  )
    errors.amount = "0 이상의 숫자를 입력해 주세요.";
  if (
    draft.amount !== null &&
    isMoneyType(draft.management_type) &&
    !draft.currency
  )
    errors.currency = "금액의 실제 통화를 선택해 주세요.";
  if (
    draft.amount !== null &&
    draft.management_type === "points" &&
    !draft.unit_name?.trim()
  )
    errors.unit_name = "포인트 단위를 입력해 주세요.";
  if (!validDateValue(draft.start_date_value, draft.start_date_precision))
    errors.start_date = "시작 날짜 형식과 정밀도를 확인해 주세요.";
  if (!validDateValue(draft.target_date_value, draft.target_date_precision))
    errors.target_date = "기한 날짜 형식과 정밀도를 확인해 주세요.";
  if (
    draft.start_date_value &&
    draft.target_date_value &&
    draft.start_date_precision === draft.target_date_precision &&
    draft.start_date_value > draft.target_date_value
  )
    errors.target_date = "종료·갱신 날짜는 시작 날짜보다 빠를 수 없어요.";
  return errors;
}

export function buildManagedItemPayload(
  draft: ManagedItemDraft,
  userId: string,
): ManagedItemPayload {
  const amount = isMoneyType(draft.management_type) || draft.management_type === "points"
    ? draft.amount
    : null;
  const exactStart =
    draft.start_date_precision === "day" ? draft.start_date_value : null;
  const exactTarget =
    draft.target_date_precision === "day" ? draft.target_date_value : null;
  return {
    ...draft,
    service_name: draft.service_name.trim(),
    plan_name: draft.plan_name?.trim() || null,
    provider_name: draft.provider_name?.trim() || null,
    brand_name: draft.brand_name?.trim() || null,
    brand_domain: draft.brand_domain?.trim() || null,
    brand_logo_url: draft.brand_logo_url?.trim() || null,
    brand_icon_emoji: draft.brand_icon_emoji?.trim() || null,
    amount,
    currency: amount === null ? null : draft.currency,
    unit_name: draft.unit_name?.trim() || null,
    conditions: draft.conditions?.trim() || null,
    payment_method: draft.payment_method?.trim() || null,
    category: draft.category?.trim() || null,
    memo: draft.memo?.trim() || null,
    lifecycle_status:
      !isPaymentScheduleType(draft.management_type) &&
      isTargetDateExpired(draft.target_date_value, draft.target_date_precision)
        ? "expired"
        : !isPaymentScheduleType(draft.management_type) &&
            draft.lifecycle_status === "expired"
          ? defaultLifecycleStatus(draft.management_type)
          : draft.lifecycle_status,
    reminder_days_before: draft.reminder_days_before,
    first_billing_date:
      isPaymentScheduleType(draft.management_type) ? exactStart : null,
    next_billing_date:
      isPaymentScheduleType(draft.management_type) ? exactTarget : null,
    user_id: userId,
  };
}
