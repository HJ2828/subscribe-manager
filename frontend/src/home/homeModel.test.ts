import { describe, expect, it } from "vitest";

import { createEmptyDraft, type ManagedItem } from "../phase3/model";
import {
  buildHomeSchedule,
  selectUpcomingEvents,
  summarizeNext30Days,
} from "./homeModel";

function item(overrides: Partial<ManagedItem>): ManagedItem {
  return {
    ...createEmptyDraft("recurring_subscription"),
    id: "item-1",
    user_id: "user-1",
    service_name: "테스트 구독",
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("home schedule", () => {
  it("generates recurring payments with the original month-end anchor", () => {
    const events = buildHomeSchedule(
      [
        item({
          target_date_value: "2026-01-31",
          target_date_precision: "day",
          billing_cycle: "monthly",
          amount: 10000,
          currency: "KRW",
        }),
      ],
      "2026-02-01",
      70,
    );
    expect(events.map((event) => event.date).slice(0, 2)).toEqual([
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("includes other payment deadlines in payment schedules and totals", () => {
    const events = buildHomeSchedule(
      [
        item({
          management_type: "other_payment_deadline",
          service_name: "관리비",
          target_date_value: "2026-11-25",
          target_date_precision: "day",
          amount: 50000,
          currency: "KRW",
        }),
      ],
      "2026-11-03",
      30,
    );
    expect(events[0]).toMatchObject({ kind: "payment", name: "관리비" });
    expect(summarizeNext30Days(events, "2026-11-03").totals).toEqual({ KRW: 50000 });
  });

  it("counts dated payments without amounts but excludes them from totals", () => {
    const events = buildHomeSchedule(
      [
        item({ target_date_value: "2026-11-10", target_date_precision: "day" }),
        item({
          id: "item-2",
          target_date_value: "2026-11-12",
          target_date_precision: "day",
          amount: 9,
          currency: "USD",
        }),
      ],
      "2026-11-03",
      40,
    );
    const summary = summarizeNext30Days(events, "2026-11-03");
    expect(summary.paymentCount).toBe(2);
    expect(summary.totals).toEqual({ USD: 9 });
    expect(summary.excludedAmountCount).toBe(1);
  });

  it("keeps month-precision benefits out of dated schedules", () => {
    const events = buildHomeSchedule(
      [
        item({
          id: "benefit",
          management_type: "gifticon",
          lifecycle_status: "unused",
          target_date_value: "2026-11",
          target_date_precision: "month",
        }),
      ],
      "2026-11-03",
    );
    expect(events).toEqual([]);
  });

  it("keeps a benefit's confirmed amount for display without adding it to payment totals", () => {
    const events = buildHomeSchedule(
      [
        item({
          id: "benefit",
          management_type: "gifticon",
          lifecycle_status: "unused",
          target_date_value: "2026-11-20",
          target_date_precision: "day",
          amount: 15000,
          currency: "KRW",
        }),
      ],
      "2026-11-03",
    );
    expect(events[0]).toMatchObject({ kind: "benefit", amount: 15000, currency: "KRW" });
    expect(summarizeNext30Days(events, "2026-11-03").totals).toEqual({});
  });

  it("filters and limits upcoming rows to six", () => {
    const events = Array.from({ length: 8 }, (_, index) => ({
      key: `event-${index}`,
      itemId: `item-${index}`,
      kind: (index % 2 ? "benefit" : "payment") as "benefit" | "payment",
      date: `2026-11-${String(index + 3).padStart(2, "0")}`,
      name: `항목 ${index}`,
      managementType: (index % 2 ? "gifticon" : "recurring_subscription") as
        | "gifticon"
        | "recurring_subscription",
      providerName: null,
      planName: null,
      billingCycle: null,
      amount: null,
      currency: null,
    }));
    expect(selectUpcomingEvents(events, "all")).toHaveLength(6);
    expect(selectUpcomingEvents(events, "benefit")).toHaveLength(4);
    expect(selectUpcomingEvents(events, "benefit").every((event) => event.kind === "benefit")).toBe(true);
  });

  it("includes a warranty benefit and keeps its provider for the upcoming subtitle", () => {
    const events = buildHomeSchedule(
      [
        item({
          id: "warranty",
          management_type: "warranty",
          service_name: "노트북",
          provider_name: "제조사",
          lifecycle_status: "unused",
          target_date_value: "2026-11-20",
          target_date_precision: "day",
        }),
      ],
      "2026-11-03",
    );
    expect(events[0]).toMatchObject({
      kind: "benefit",
      managementType: "warranty",
      providerName: "제조사",
    });
  });

  it("shows only the nearest occurrence for the same item", () => {
    const events = buildHomeSchedule(
      [
        item({
          target_date_value: "2026-11-29",
          target_date_precision: "day",
          billing_cycle: "monthly",
        }),
      ],
      "2026-11-03",
      100,
    );
    expect(events.length).toBeGreaterThan(1);
    expect(selectUpcomingEvents(events, "all").map((event) => event.date)).toEqual([
      "2026-11-29",
    ]);
  });
});
