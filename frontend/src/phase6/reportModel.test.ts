import { describe, expect, it } from "vitest";

import { createEmptyDraft, type ManagedItem } from "../phase3/model";
import { buildDailyBreakdown, buildMetricRows, buildMonthlyBreakdown, buildPaymentReceipts, summarizeReport, type SubscriptionRelationship } from "./reportModel";

function item(overrides: Partial<ManagedItem> = {}): ManagedItem {
  return {
    ...createEmptyDraft("recurring_subscription"),
    id: "parent",
    user_id: "user",
    service_name: "서비스",
    amount: 12000,
    currency: "KRW",
    billing_cycle: "monthly",
    start_date_value: "2026-01-01",
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const included: SubscriptionRelationship = {
  id: "relation",
  user_id: "user",
  parent_item_id: "parent",
  child_item_id: "child",
  relationship_type: "included_benefit",
  cost_item_id: "parent",
  created_at: "2026-11-03T00:00:00Z",
  updated_at: "2026-11-03T00:00:00Z",
};

describe("phase 6 report calculations", () => {
  it("counts an included benefit cost only at its attributed parent", () => {
    const summary = summarizeReport(
      [
        { id: "p", item_id: "parent", event_type: "payment", event_date: "2026-11-03", amount: 10000, currency: "KRW" },
        { id: "c", item_id: "child", event_type: "payment", event_date: "2026-11-03", amount: 5000, currency: "KRW" },
      ],
      [included],
      "2026-11-01",
      "2026-11-30",
      "2026-11-03",
    );
    expect(summary.totalByCurrency).toEqual({ KRW: 10000 });
    expect(summary.remainingByCurrency).toEqual({});
    expect(summary.duplicateExcludedCount).toBe(1);
  });

  it("keeps currencies separate and excludes unknown amounts", () => {
    const summary = summarizeReport(
      [
        { id: "a", item_id: "a", event_type: "payment", event_date: "2026-11-04", amount: 10, currency: "USD" },
        { id: "b", item_id: "b", event_type: "payment", event_date: "2026-11-04", amount: 1000, currency: "KRW" },
        { id: "c", item_id: "c", event_type: "payment", event_date: "2026-11-04", amount: null, currency: null },
      ], [], "2026-11-01", "2026-11-30", "2026-11-03",
    );
    expect(summary.totalByCurrency).toEqual({ USD: 10, KRW: 1000 });
    expect(summary.missingAmountCount).toBe(1);
  });

  it("keeps non-default currencies from recorded payments", () => {
    const summary = summarizeReport(
      [], [], "2026-11-01", "2026-11-30", "2026-11-05",
      [{ item_id: "a", occurrence_date: "2026-11-01", payment_date: "2026-11-04", amount: 12, currency: "USD" }],
    );
    expect(summary.pastByCurrency).toEqual({ USD: 12 });
  });

  it("counts past registered schedules and does not double-count their payment records", () => {
    const summary = summarizeReport(
      [{ id: "past", item_id: "a", event_type: "payment", event_date: "2026-11-01", amount: 100, currency: "USD" }],
      [], "2026-11-01", "2026-11-30", "2026-11-05",
      [{ item_id: "a", occurrence_date: "2026-11-01", payment_date: "2026-11-01", amount: 100, currency: "USD" }],
    );
    expect(summary.pastByCurrency).toEqual({ USD: 100 });
  });

  it("uses a payment record for today instead of treating today's schedule as future", () => {
    const summary = summarizeReport(
      [{ id: "today", item_id: "a", event_type: "payment", event_date: "2026-11-05", amount: 12000, currency: "KRW" }],
      [], "2026-11-01", "2026-11-30", "2026-11-05",
      [{ item_id: "a", occurrence_date: "2026-11-05", payment_date: "2026-11-05", amount: 12000, currency: "KRW" }],
    );
    expect(summary.remainingByCurrency).toEqual({});
    expect(summary.pastByCurrency).toEqual({ KRW: 12000 });
  });

  it("builds a daily breakdown for short report periods", () => {
    const points = buildDailyBreakdown(
      [{ id: "d", item_id: "a", event_type: "payment", event_date: "2026-11-03", amount: 10, currency: "USD" }],
      [], "2026-11-01", "2026-11-05", "2026-11-05", "USD",
    );
    expect(points).toHaveLength(5);
    expect(points[2]).toMatchObject({ month: "2026-11-03", past: 10, total: 10 });
  });

  it("uses only recorded price periods for accumulated estimates", () => {
    const rows = buildMetricRows(
      [item()], [],
      [{ item_id: "parent", amount: 12000, currency: "KRW", billing_cycle: "monthly", effective_from: "2026-11-01", effective_to: null }],
      "KRW", "2026-11-03",
    );
    expect(rows[0].monthlyEquivalent).toBe(12000);
    expect(rows[0].estimatedAccumulated).toBeGreaterThan(1000);
    expect(rows[0].estimatedAccumulated).toBeLessThan(1300);
  });

  it("applies each recorded price to the billing occurrence active on that date", () => {
    const receipts = buildPaymentReceipts(
      item({
        first_billing_date: "2026-09-03",
        start_date_value: "2026-09-03",
      }),
      [
        { item_id: "parent", amount: 1000, currency: "KRW", billing_cycle: "monthly", effective_from: "2026-09-01", effective_to: "2026-10-31" },
        { item_id: "parent", amount: 2000, currency: "KRW", billing_cycle: "monthly", effective_from: "2026-11-01", effective_to: null },
      ],
      "2026-11-05",
    );
    expect(receipts).toEqual([
      { occurrenceDate: "2026-09-03", eventDate: "2026-09-03", amount: 1000, currency: "KRW" },
      { occurrenceDate: "2026-10-03", eventDate: "2026-10-03", amount: 1000, currency: "KRW" },
      { occurrenceDate: "2026-11-03", eventDate: "2026-11-03", amount: 2000, currency: "KRW" },
    ]);
    expect(receipts.reduce((sum, receipt) => sum + receipt.amount, 0)).toBe(4000);
  });

  it("applies the first registered price to earlier billing dates entered later", () => {
    const receipts = buildPaymentReceipts(
      item({
        first_billing_date: "2026-10-01",
        start_date_value: "2026-10-01",
        amount: 1000,
      }),
      [
        { item_id: "parent", amount: 1000, currency: "KRW", billing_cycle: "monthly", effective_from: "2026-11-05", effective_to: null },
      ],
      "2026-11-05",
    );
    expect(receipts).toEqual([
      { occurrenceDate: "2026-10-01", eventDate: "2026-10-01", amount: 1000, currency: "KRW" },
      { occurrenceDate: "2026-11-01", eventDate: "2026-11-01", amount: 1000, currency: "KRW" },
    ]);
    expect(receipts.reduce((sum, receipt) => sum + receipt.amount, 0)).toBe(2000);
  });

  it("uses a saved payment record date and amount for its original occurrence", () => {
    const receipts = buildPaymentReceipts(
      item({ first_billing_date: "2026-10-01", start_date_value: "2026-10-01" }),
      [
        { item_id: "parent", amount: 1000, currency: "KRW", billing_cycle: "monthly", effective_from: "2026-10-01", effective_to: null },
      ],
      "2026-11-05",
      [
        { occurrence_date: "2026-10-01", payment_date: "2026-10-03", amount: 1200, currency: "KRW" },
      ],
    );

    expect(receipts[0]).toEqual({
      occurrenceDate: "2026-10-01",
      eventDate: "2026-10-03",
      amount: 1200,
      currency: "KRW",
    });
  });

  it("splits monthly scheduled amounts into past and future without treating past as paid", () => {
    const points = buildMonthlyBreakdown([
      { id: "past", item_id: "parent", event_type: "payment", event_date: "2026-10-10", amount: 1000, currency: "KRW" },
      { id: "future", item_id: "parent", event_type: "payment", event_date: "2026-11-10", amount: 1000, currency: "KRW" },
    ], [], "2026-10-01", "2026-11-30", "2026-11-03", "KRW");
    expect(points).toEqual([
      { month: "2026-10", past: 1000, future: 0, total: 1000, count: 1 },
      { month: "2026-11", past: 0, future: 1000, total: 1000, count: 1 },
    ]);
  });
});
