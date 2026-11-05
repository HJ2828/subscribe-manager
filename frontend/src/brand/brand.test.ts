import { describe, expect, it } from "vitest";

import { matchLocalBrands, normalizeBrandText } from "./brand";

describe("brand alias matching", () => {
  it("normalizes Korean spacing and punctuation without changing the original value", () => {
    expect(normalizeBrandText(" 스벅-쿠폰 ")).toBe("스벅쿠폰");
    expect(matchLocalBrands(["스벅 쿠폰"])[0]?.domain).toBe("starbucks.co.kr");
  });

  it.each([
    ["넷플", "netflix.com"],
    ["배달의 민족", "baemin.com"],
    ["배민", "baemin.com"],
    ["푸라닭", "puradakchicken.com"],
    ["플스", "playstation.com"],
  ])("maps %s to %s", (input, domain) => {
    expect(matchLocalBrands([input])[0]?.domain).toBe(domain);
  });

  it("prefers the longer matching alias", () => {
    expect(matchLocalBrands(["스타벅스 쿠폰"])[0]?.domain).toBe("starbucks.co.kr");
  });
});
