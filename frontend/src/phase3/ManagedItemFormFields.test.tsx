import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyDraft } from "./model";
import { ManagedItemFormFields } from "./Phase3Pages";

describe("shared managed item form", () => {
  afterEach(cleanup);

  it("shows required marks, KRW default, payment routes, and revised categories", () => {
    render(
      <ManagedItemFormFields
        draft={{ ...createEmptyDraft("recurring_subscription"), amount: 10000 }}
        update={vi.fn()}
        changeType={vi.fn()}
        errors={{}}
        actions={<button type="submit">저장</button>}
      />,
    );

    expect(screen.getByLabelText(/^서비스명/)).toBeRequired();
    expect(screen.getByLabelText(/^실제 통화/)).toHaveValue("KRW");
    expect(screen.getByRole("option", { name: "토스페이" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "카카오페이" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "네이버페이" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "카드사" })).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="영상·콘텐츠·OTT"]')).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="건강·운동"]')).toBeInTheDocument();
    expect(document.querySelector('datalist option[value="라이프·기록"]')).toBeInTheDocument();
    const categories = Array.from(
      document.querySelectorAll<HTMLDataListElement>("#category-options option"),
    ).map((option) => option.getAttribute("value"));
    expect(categories).not.toContain("영상·콘텐츠");
    expect(categories).not.toContain("쇼핑·생활");
    expect(categories).not.toContain("생산성");
    expect(categories.at(-1)).toBe("기타");
    expect(document.querySelectorAll(".required-mark").length).toBeGreaterThanOrEqual(3);
  });

  it("renders the complete gifticon form and marks only image-filled fields", () => {
    render(
      <ManagedItemFormFields
        draft={{
          ...createEmptyDraft("gifticon"),
          service_name: "아메리카노 교환권",
          provider_name: "예시 카페",
        }}
        update={vi.fn()}
        changeType={vi.fn()}
        errors={{}}
        imageFilledFields={new Set(["service_name", "provider_name"])}
        actions={<button type="submit">저장</button>}
      />,
    );

    expect(screen.getByLabelText(/^이름/)).toHaveValue("아메리카노 교환권");
    expect(screen.getByLabelText(/^사용처/)).toHaveValue("예시 카페");
    expect(screen.getByLabelText("금액")).toHaveValue(null);
    expect(screen.getByLabelText("실제 통화")).toHaveValue("KRW");
    expect(screen.getByLabelText("유효기간 정밀도")).toBeInTheDocument();
    expect(screen.getByLabelText("이용 조건")).toBeInTheDocument();
    expect(screen.getByLabelText("사용 상태")).toBeInTheDocument();
    expect(screen.getByLabelText("카테고리")).toBeInTheDocument();
    expect(screen.getByLabelText("알림")).toBeDisabled();
    expect(screen.getByLabelText("메모")).toBeInTheDocument();
    expect(screen.getAllByText("이미지에서 입력됨")).toHaveLength(2);
  });
});
