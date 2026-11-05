import { describe, expect, it } from "vitest";

import { createEmptyDraft, type ManagedItem } from "../phase3/model";
import { buildCalendarEvents, filterCalendarEvents, monthGrid, weekDates } from "./calendarModel";

function item(overrides: Partial<ManagedItem>): ManagedItem {
  return {
    ...createEmptyDraft(), id: "item-1", user_id: "user-1", completed_at: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides,
  };
}

describe("phase 5 calendar model", () => {
  it("uses the same anchored monthly payment schedule as the home", () => {
    const events = buildCalendarEvents([item({ target_date_value: "2026-01-31", target_date_precision: "day" })], "2026-01-01", "2026-03-31");
    expect(events.map((event) => event.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("includes historical recurring payment dates from the first billing date", () => {
    const events = buildCalendarEvents([item({
      first_billing_date: "2026-08-01",
      target_date_value: "2026-12-01",
      target_date_precision: "day",
      amount: 100,
      currency: "USD",
    })], "2026-08-01", "2026-11-30");
    expect(events.map((event) => event.date)).toEqual([
      "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01",
    ]);
  });

  it("maps exact non-recurring dates without inventing month precision dates", () => {
    const events = buildCalendarEvents([
      item({ id: "fixed", management_type: "fixed_term_membership", target_date_value: "2026-03-10", target_date_precision: "day" }),
      item({ id: "warranty", management_type: "warranty", target_date_value: "2026-03", target_date_precision: "month" }),
    ], "2026-03-01", "2026-03-31");
    expect(events.map((event) => event.kind)).toEqual(["renewal"]);
  });

  it("filters kinds and builds Monday based grids", () => {
    const events = buildCalendarEvents([item({ target_date_value: "2026-03-10", target_date_precision: "day" })], "2026-03-01", "2026-03-31");
    expect(filterCalendarEvents(events, new Set(["expiry"]))).toHaveLength(0);
    expect(monthGrid("2026-03")[0]).toBe("2026-02-23");
    expect(weekDates("2026-03-11")[0]).toBe("2026-03-09");
  });
});
