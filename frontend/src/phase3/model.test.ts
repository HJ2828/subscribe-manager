import { describe, expect, it } from "vitest";

import {
  buildManagedItemPayload,
  createEmptyDraft,
  displayDate,
  isTargetDateExpired,
  itemStatusValue,
  proposeNextRecurringDate,
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
});
