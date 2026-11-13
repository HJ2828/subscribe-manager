import { describe, expect, it } from "vitest";

import {
  buildManagedItemPayload,
  createEmptyDraft,
  displayDate,
  formatDday,
  isPastDate,
  isTargetDateExpired,
  itemStatusValue,
  proposeNextRecurringDate,
  rollForwardRecurringItem,
  type ManagedItem,
  validDateValue,
} from "./model";

describe("Phase 3 date precision", () => {
  it("keeps a year-month value as month precision", () => {
    expect(validDateValue("2025-01", "month")).toBe(true);
    expect(displayDate("2025-01", "month")).toBe("2025년 1월");
    expect(displayDate("2025-01-15", "day")).toBe("2025. 01. 15");
    expect(proposeNextRecurringDate("2025-01", "month", "monthly")).toBeNull();
  });

  it("rejects a calendar date that does not exist", () => {
    expect(validDateValue("2025-02-29", "day")).toBe(false);
    expect(validDateValue("2024-02-29", "day")).toBe(true);
  });

  it("preserves the original month-end anchor", () => {
    expect(
      proposeNextRecurringDate(
        "2025-01-31",
        "day",
        "monthly",
        new Date("2025-02-01T00:00:00Z"),
      ),
    ).toBe("2025-02-28");
    expect(
      proposeNextRecurringDate(
        "2025-01-31",
        "day",
        "monthly",
        new Date("2025-03-01T00:00:00Z"),
      ),
    ).toBe("2025-03-31");
  });

  it("handles leap-year annual recurrence", () => {
    expect(
      proposeNextRecurringDate(
        "2024-02-29",
        "day",
        "yearly",
        new Date("2025-01-01T00:00:00Z"),
      ),
    ).toBe("2025-02-28");
  });
});

describe("Phase 3 D-day labels", () => {
  const now = new Date(2026, 10, 4);

  it("uses the design-system ranges for upcoming dates", () => {
    expect(formatDday("2026-11-04", "day", now)).toEqual({ label: "D-day", tone: "urgent" });
    expect(formatDday("2026-11-07", "day", now)).toEqual({ label: "D-3", tone: "urgent" });
    expect(formatDday("2026-11-11", "day", now)).toEqual({ label: "D-7", tone: "soon" });
    expect(formatDday("2026-11-12", "day", now)).toEqual({ label: "D-8", tone: "normal" });
  });

  it("shows past dates as D+ and omits imprecise dates", () => {
    expect(formatDday("2026-09-13", "day", now)).toEqual({ label: "D+52", tone: "ended" });
    expect(formatDday("2026-11", "month", now)).toBeNull();
    expect(formatDday(null, "day", now)).toBeNull();
  });

  it("identifies past day and month values for the list visibility filter", () => {
    expect(isPastDate("2026-11-03", "day", now)).toBe(true);
    expect(isPastDate("2026-11-04", "day", now)).toBe(false);
    expect(isPastDate("2026-10", "month", now)).toBe(true);
    expect(isPastDate("2026-11", "month", now)).toBe(false);
    expect(isPastDate(null, "day", now)).toBe(false);
  });
});

describe("Phase 3 recurring payment rollover", () => {
  function recurring(overrides: Partial<ManagedItem> = {}) {
    return {
      ...createEmptyDraft("recurring_subscription"),
      id: "item-1",
      user_id: "user-1",
      service_name: "정기 결제",
      target_date_value: "2026-11-03",
      target_date_precision: "day",
      next_billing_date: "2026-11-03",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      ...overrides,
    } as ManagedItem;
  }

  it("moves a passed monthly payment to the next cycle", () => {
    const rolled = rollForwardRecurringItem(recurring(), "2026-11-04");
    expect(rolled.target_date_value).toBe("2026-12-03");
    expect(rolled.next_billing_date).toBe("2026-12-03");
  });

  it("does not roll dates when automatic renewal is off", () => {
    const item = recurring({ auto_renewal_status: "off" });
    expect(rollForwardRecurringItem(item, "2026-11-04")).toBe(item);
  });

  it("preserves a month-end anchor after February", () => {
    const rolled = rollForwardRecurringItem(
      recurring({
        first_billing_date: "2026-01-31",
        target_date_value: "2026-02-28",
        next_billing_date: "2026-02-28",
      }),
      "2026-03-01",
    );
    expect(rolled.target_date_value).toBe("2026-03-31");
  });
});

describe("Phase 3 list status styling key", () => {
  const now = new Date(2026, 10, 2);

  it("keeps recurring subscription status even after its target date", () => {
    expect(
      itemStatusValue({
        management_type: "recurring_subscription",
        actual_status: "in_use",
        lifecycle_status: "active",
        target_date_value: "2026-10-01",
        target_date_precision: "day",
      }, now),
    ).toBe("in_use");
    expect(
      itemStatusValue({
        management_type: "other_payment_deadline",
        actual_status: "in_use",
        lifecycle_status: "active",
        target_date_value: "2026-10-01",
        target_date_precision: "day",
      }, now),
    ).toBe("in_use");
  });

  it("automatically expires every other type after a day or month target", () => {
    expect(
      itemStatusValue({
        management_type: "fixed_term_membership",
        actual_status: "needs_review",
        lifecycle_status: "active",
        target_date_value: "2026-11-01",
        target_date_precision: "day",
      }, now),
    ).toBe("expired");
    expect(isTargetDateExpired("2026-10", "month", now)).toBe(true);
    expect(isTargetDateExpired("2026-11", "month", now)).toBe(false);
  });

  it("stores the automatic expiry in a non-recurring save payload", () => {
    const payload = buildManagedItemPayload(
      {
        ...createEmptyDraft("gifticon"),
        service_name: "교환권",
        target_date_value: "2026-11-01",
      },
      "user-id",
    );
    expect(payload.lifecycle_status).toBe("expired");
  });

  it("clears automatic expiry after the target date moves to the future", () => {
    const payload = buildManagedItemPayload(
      {
        ...createEmptyDraft("gifticon"),
        service_name: "교환권",
        target_date_value: "2999-11-01",
        lifecycle_status: "expired",
      },
      "user-id",
    );
    expect(payload.lifecycle_status).toBe("unused");
  });

  it("does not persist amount or currency for warranty items", () => {
    const payload = buildManagedItemPayload(
      {
        ...createEmptyDraft("warranty"),
        service_name: "제품 보증",
        amount: 50000,
        currency: "KRW",
      },
      "user-id",
    );
    expect(payload.amount).toBeNull();
    expect(payload.currency).toBeNull();
  });
});
