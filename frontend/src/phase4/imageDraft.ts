import {
  canMarkUsed,
  createEmptyDraft,
  isMoneyType,
  validDateValue,
  type ManagedItemDraft,
  type ManagementType,
} from "../phase3/model";

export type ImageDetectedField = {
  field: string;
  value: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

export type ImageExtraction = Partial<ManagedItemDraft> & {
  management_type?: ManagementType;
  detected_fields?: ImageDetectedField[];
  missing_fields?: string[];
  notes?: string;
};

const EXTRACTABLE_FIELDS = [
  "service_name",
  "plan_name",
  "provider_name",
  "amount",
  "currency",
  "unit_name",
  "billing_cycle",
  "start_date_value",
  "start_date_precision",
  "target_date_value",
  "target_date_precision",
  "conditions",
  "lifecycle_status",
  "actual_status",
  "auto_renewal_status",
  "usage_plan",
  "payment_method",
  "category",
  "memo",
] as const satisfies ReadonlyArray<keyof ManagedItemDraft>;

export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number];

const extractable = new Set<string>(EXTRACTABLE_FIELDS);

export function canStartImageAnalysis(
  hasFile: boolean,
  consented: boolean,
  busy: boolean,
) {
  return hasFile && consented && !busy;
}

export function createImageDraft(type: ManagementType): ManagedItemDraft {
  return createEmptyDraft(type);
}

export function retargetImageDraft(
  current: ManagedItemDraft,
  type: ManagementType,
): { draft: ManagedItemDraft; retainedFields: Set<keyof ManagedItemDraft> } {
  const recurring = type === "recurring_subscription";
  const paymentSchedule = recurring || type === "other_payment_deadline";
  const fixed = type === "fixed_term_membership";
  const warranty = type === "warranty";
  const points = type === "points";
  const consumable = canMarkUsed(type);
  const retainedFields = new Set<keyof ManagedItemDraft>([
    "service_name",
    "target_date_value",
    "target_date_precision",
    "category",
    "memo",
    "reminder_days_before",
    "reminder_time",
  ]);

  if (isMoneyType(type)) {
    retainedFields.add("amount");
    retainedFields.add("currency");
  }
  if (recurring || fixed) retainedFields.add("plan_name");
  if (consumable || points || warranty) retainedFields.add("provider_name");
  if (points) {
    retainedFields.add("amount");
    retainedFields.add("unit_name");
  }
  if (paymentSchedule) {
    retainedFields.add("billing_cycle");
    retainedFields.add("payment_method");
  }
  if (paymentSchedule || fixed || warranty) {
    retainedFields.add("start_date_value");
    retainedFields.add("start_date_precision");
  }
  if (consumable || points || warranty) retainedFields.add("conditions");
  if (paymentSchedule || fixed) {
    retainedFields.add("actual_status");
    retainedFields.add("auto_renewal_status");
    retainedFields.add("usage_plan");
  } else {
    retainedFields.add("lifecycle_status");
  }

  const draft = createImageDraft(type);
  for (const key of retainedFields) {
    (draft as Record<string, unknown>)[key] = current[key];
  }
  return { draft, retainedFields };
}

function isPresent(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function isAllowedValue(key: ExtractableField, value: unknown) {
  if (!isPresent(value)) return false;
  if (key === "amount")
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (key === "currency")
    return typeof value === "string" && /^[A-Z]{3}$/.test(value);
  if (key === "billing_cycle")
    return ["monthly", "yearly", "custom"].includes(String(value));
  if (key === "start_date_precision" || key === "target_date_precision")
    return value === "day" || value === "month";
  if (key === "lifecycle_status")
    return ["active", "unused", "used", "ended", "expired", "needs_review"].includes(
      String(value),
    );
  if (key === "actual_status")
    return ["in_use", "temporarily_paused", "payment_issue", "ended", "needs_review"].includes(
      String(value),
    );
  if (key === "auto_renewal_status")
    return ["on", "off", "manual", "needs_review"].includes(String(value));
  if (key === "usage_plan")
    return ["scheduled", "ended", "needs_review"].includes(String(value));
  return typeof value === "string";
}

export function applyImageExtraction(
  current: ManagedItemDraft,
  extraction: ImageExtraction,
): {
  draft: ManagedItemDraft;
  filledFields: Set<keyof ManagedItemDraft>;
} {
  const detected = new Set(
    (extraction.detected_fields || [])
      .map((row) => row.field)
      .filter((field) => extractable.has(field)),
  );
  const draft = { ...current, management_type: current.management_type };
  const filledFields = new Set<keyof ManagedItemDraft>();

  for (const key of EXTRACTABLE_FIELDS) {
    if (!detected.has(key)) continue;
    const value = extraction[key];
    if (!isAllowedValue(key, value)) continue;
    (draft as Record<string, unknown>)[key] = value;
    filledFields.add(key);
  }

  for (const prefix of ["start", "target"] as const) {
    const valueKey = `${prefix}_date_value` as const;
    const precisionKey = `${prefix}_date_precision` as const;
    if (!filledFields.has(valueKey)) continue;
    const precision = filledFields.has(precisionKey)
      ? draft[precisionKey]
      : null;
    if (!validDateValue(draft[valueKey], precision)) {
      draft[valueKey] = current[valueKey];
      draft[precisionKey] = current[precisionKey];
      filledFields.delete(valueKey);
      filledFields.delete(precisionKey);
    }
  }

  return { draft, filledFields };
}
