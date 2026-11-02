import { describe, expect, it } from "vitest";

import {
  buildManagedItemPayload,
  createEmptyDraft,
} from "../phase3/model";
import {
  applyImageExtraction,
  canStartImageAnalysis,
  createImageDraft,
  retargetImageDraft,
  type ImageExtraction,
} from "./imageDraft";

const detected = (field: string, value: string) => ({
  field,
  value,
  evidence: "이미지에 표시됨",
  confidence: "high" as const,
});

describe("Phase 4 image extraction mapping", () => {
  it("enables analysis only when a file and AI consent are both present", () => {
    expect(canStartImageAnalysis(true, true, false)).toBe(true);
    expect(canStartImageAnalysis(false, true, false)).toBe(false);
    expect(canStartImageAnalysis(true, false, false)).toBe(false);
    expect(canStartImageAnalysis(true, true, true)).toBe(false);
  });

  it("keeps values that have matching fields when the analyzed type changes", () => {
    const current = {
      ...createEmptyDraft("gifticon"),
      service_name: "커피 교환권",
      provider_name: "예시 카페",
      amount: 5000,
      currency: "KRW",
      target_date_value: "2027-12",
      target_date_precision: "month" as const,
      conditions: "일부 매장 제외",
      category: "식품·카페·외식",
      memo: "사용자 메모",
    };

    const changed = retargetImageDraft(current, "recurring_subscription");

    expect(changed.draft).toMatchObject({
      management_type: "recurring_subscription",
      service_name: "커피 교환권",
      amount: 5000,
      currency: "KRW",
      target_date_value: "2027-12",
      target_date_precision: "month",
      category: "식품·카페·외식",
      memo: "사용자 메모",
    });
    expect(changed.draft.provider_name).toBe("");
    expect(changed.draft.conditions).toBe("");
    expect(changed.retainedFields.has("amount")).toBe(true);
    expect(changed.retainedFields.has("provider_name")).toBe(false);
  });

  it("fills only detected gifticon fields and leaves the full form editable", () => {
    const extraction: ImageExtraction = {
      management_type: "gifticon",
      service_name: "아메리카노 교환권",
      provider_name: "예시 카페",
      amount: 5000,
      currency: "KRW",
      target_date_value: "2027-03-31",
      target_date_precision: "day",
      detected_fields: [
        detected("service_name", "아메리카노 교환권"),
        detected("provider_name", "예시 카페"),
      ],
    };

    const result = applyImageExtraction(
      createImageDraft("gifticon"),
      extraction,
    );

    expect(result.draft.service_name).toBe("아메리카노 교환권");
    expect(result.draft.provider_name).toBe("예시 카페");
    expect(result.draft.amount).toBeNull();
    expect(result.draft.currency).toBe("KRW");
    expect(result.draft.target_date_value).toBeNull();
    expect([...result.filledFields]).toEqual(["service_name", "provider_name"]);
  });

  it("preserves month precision without inventing a day", () => {
    const result = applyImageExtraction(createEmptyDraft("warranty"), {
      target_date_value: "2028-05",
      target_date_precision: "month",
      detected_fields: [
        detected("target_date_value", "2028-05"),
        detected("target_date_precision", "month"),
      ],
    });

    expect(result.draft.target_date_value).toBe("2028-05");
    expect(result.draft.target_date_precision).toBe("month");
  });

  it("does not clear manually entered fields that were not detected", () => {
    const current = {
      ...createEmptyDraft("gifticon"),
      amount: 4000,
      currency: "KRW",
      conditions: "사용자가 직접 입력한 조건",
    };
    const result = applyImageExtraction(current, {
      service_name: "커피 교환권",
      amount: 5000,
      detected_fields: [detected("service_name", "커피 교환권")],
    });

    expect(result.draft.service_name).toBe("커피 교환권");
    expect(result.draft.amount).toBe(4000);
    expect(result.draft.currency).toBe("KRW");
    expect(result.draft.conditions).toBe("사용자가 직접 입력한 조건");
  });

  it("keeps user corrections in the shared final-save payload", () => {
    const mapped = applyImageExtraction(createEmptyDraft("gifticon"), {
      service_name: "커피 교환권",
      provider_name: "예시 카페",
      detected_fields: [detected("service_name", "커피 교환권")],
    });
    const corrected = {
      ...mapped.draft,
      service_name: "아이스 커피 교환권",
      amount: 4500,
      currency: "KRW",
      target_date_value: "2027-12",
      target_date_precision: "month" as const,
      conditions: "일부 매장 제외",
    };

    const payload = buildManagedItemPayload(corrected, "user-1");

    expect(payload).toMatchObject({
      user_id: "user-1",
      management_type: "gifticon",
      service_name: "아이스 커피 교환권",
      amount: 4500,
      currency: "KRW",
      target_date_value: "2027-12",
      target_date_precision: "month",
      conditions: "일부 매장 제외",
    });
  });
});
