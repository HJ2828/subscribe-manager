import type { SupabaseClient } from "@supabase/supabase-js";

import { rollForwardRecurringItem, type ManagedItem } from "../phase3/model";

function todayInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function syncRecurringItemDates(
  client: SupabaseClient,
  userId: string,
  items: ManagedItem[],
  timeZone?: string,
) {
  let zone = timeZone;
  if (!zone) {
    const profile = await client.from("profiles").select("timezone").eq("id", userId).single();
    zone = profile.data?.timezone || "Asia/Seoul";
  }
  const today = todayInZone(zone || "Asia/Seoul");
  const candidates = items
    .map((item) => ({ original: item, rolled: rollForwardRecurringItem(item, today) }))
    .filter(({ original, rolled }) => original !== rolled);

  const results = await Promise.all(
    candidates.map(async ({ original, rolled }) => {
      const result = await client
        .from("items")
        .update({
          target_date_value: rolled.target_date_value,
          target_date_precision: rolled.target_date_precision,
          next_billing_date: rolled.next_billing_date,
        })
        .eq("id", original.id)
        .eq("user_id", userId);
      return { id: original.id, rolled, failed: Boolean(result.error) };
    }),
  );
  const applied = new Map(results.filter((result) => !result.failed).map((result) => [result.id, result.rolled]));
  return {
    items: items.map((item) => applied.get(item.id) || item),
    failedCount: results.filter((result) => result.failed).length,
  };
}
