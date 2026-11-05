import { useState } from "react";
import brandList from "../data/brand-list.json";

export type BrandRecord = { domain: string; aliases: string[] };
export type BrandCandidate = { domain: string; name?: string; logo_url?: string | null };

const records = brandList as BrandRecord[];

export function normalizeBrandText(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]/gu, "");
}

export function matchLocalBrands(values: Array<string | null | undefined>) {
  const inputs = values.map((value) => normalizeBrandText(value || "")).filter(Boolean);
  const matches = new Map<string, { record: BrandRecord; score: number; alias: string }>();
  for (const record of records) {
    for (const alias of record.aliases) {
      const normalizedAlias = normalizeBrandText(alias);
      if (!normalizedAlias) continue;
      const score = inputs.reduce((best, input) => {
        if (input === normalizedAlias) return Math.max(best, normalizedAlias.length + 1000);
        if (input.includes(normalizedAlias)) return Math.max(best, normalizedAlias.length);
        return best;
      }, 0);
      if (!score) continue;
      const previous = matches.get(record.domain);
      if (!previous || score > previous.score) matches.set(record.domain, { record, score, alias });
    }
  }
  return [...matches.values()]
    .sort((left, right) => right.score - left.score || right.alias.length - left.alias.length)
    .map(({ record, alias }) => ({ domain: record.domain, name: alias, logo_url: null }));
}

export function brandLogoUrl(domain: string | null | undefined, logoUrl?: string | null) {
  return logoUrl || (domain ? `https://cdn.brandfetch.io/domain/${domain}` : null);
}

export function BrandIcon({ name, domain, logoUrl, className = "" }: {
  name: string;
  domain?: string | null;
  logoUrl?: string | null;
  className?: string;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const resolvedDomain = domain || matchLocalBrands([name])[0]?.domain || null;
  const initial = name.trim().slice(0, 1).toLocaleUpperCase("ko-KR") || "?";
  const sources = [
    brandLogoUrl(resolvedDomain, logoUrl),
    resolvedDomain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(resolvedDomain)}&sz=128` : null,
  ].filter(Boolean) as string[];
  const src = sources[sourceIndex] || null;
  function onError() {
    setSourceIndex((current) => current + 1);
  }
  return (
    <i className={`brand-icon ${className}`} aria-hidden="true">
      {src ? <img src={src} alt="" onError={onError} /> : null}
      {!src ? initial : null}
    </i>
  );
}
