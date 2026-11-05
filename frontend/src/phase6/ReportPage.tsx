import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { todayInTimeZone } from "../home/homeModel";
import { syncRecurringItemDates } from "../lib/recurringItems";
import { isPaymentScheduleType, type ManagedItem } from "../phase3/model";
import { PageHeader } from "../components/ui";
import { buildCalendarEvents } from "../phase5/calendarModel";
import {
  buildMetricRows,
  buildDailyBreakdown,
  buildMonthlyBreakdown,
  metricValue,
  summarizeReport,
  type ItemStatusHistory,
  type PaymentRecord,
  type PricePeriod,
  type ReportEvent,
  type RelationshipType,
  type SubscriptionRelationship,
} from "./reportModel";
import { BubbleForceChart, type BubbleChartItem } from "./BubbleForceChart";
import "./phase6.css";
import "./phase6-extra.css";

function formatMoneyValue(value: number, currency: string) {
  const formatted = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
  return currency === "KRW" ? `${formatted}원` : `${currency} ${formatted}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function relationLabel(type: RelationshipType) {
  return type === "included_benefit"
    ? "상위 구독에 포함된 혜택"
    : type === "additional_charge"
      ? "상위 구독을 통한 추가 요금"
      : "관계 확인 · 금액 미확인";
}

export function ReportPage({ navigation }: { navigation: ReactNode }) {
  const { client, session } = useAuth();
  const initialToday = todayInTimeZone("Asia/Seoul");
  const [items, setItems] = useState<ManagedItem[]>([]);
  const [events, setEvents] = useState<ReportEvent[]>([]);
  const [relations, setRelations] = useState<SubscriptionRelationship[]>([]);
  const [periods, setPeriods] = useState<PricePeriod[]>([]);
  const [statusHistory, setStatusHistory] = useState<ItemStatusHistory[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [defaultCurrency, setDefaultCurrency] = useState("KRW");
  const [reportCurrency, setReportCurrency] = useState("KRW");
  const [start, setStart] = useState(`${initialToday.slice(0, 7)}-01`);
  const [end, setEnd] = useState(addDays(initialToday, 365));
  const currency = reportCurrency;
  const money = (value: number, code: string) => {
    const formatted = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
    return code === "KRW" && defaultCurrency !== "KRW"
      ? `KRW ${formatted}`
      : formatMoneyValue(value, code);
  };
  const [metric, setMetric] = useState<"monthly" | "accumulated" | "months">("months");
  const [view, setView] = useState<"bubble" | "chart" | "table">("bubble");
  const [showPeriodBreakdown, setShowPeriodBreakdown] = useState(false);
  const [showForeignBreakdown, setShowForeignBreakdown] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [parentId, setParentId] = useState("");
  const [childId, setChildId] = useState("");
  const [relationshipType, setRelationshipType] = useState<RelationshipType>("included_benefit");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!client || !session) return;
    setLoading(true);
    setError("");
    const [itemResult, eventResult, relationResult, periodResult, historyResult, profileResult, paymentRecordResult] = await Promise.all([
      client.from("items").select("*").eq("user_id", session.user.id),
      client.from("calendar_events").select("id,item_id,event_type,event_date,amount,currency,schedule_status").eq("user_id", session.user.id),
      client.from("subscription_relationships").select("*").eq("user_id", session.user.id),
      client.from("item_price_periods").select("item_id,amount,currency,billing_cycle,effective_from,effective_to").eq("user_id", session.user.id),
      client.from("item_status_history").select("id,item_id,event_type,previous_status,current_status,occurred_on").eq("user_id", session.user.id).order("occurred_on", { ascending: false }),
      client.from("profiles").select("timezone,default_currency").eq("id", session.user.id).single(),
      client.from("item_payment_records").select("item_id,occurrence_date,payment_date,amount,currency").eq("user_id", session.user.id),
    ]);
    const failure = itemResult.error || eventResult.error || relationResult.error || periodResult.error || historyResult.error || profileResult.error;
    if (failure || !profileResult.data) {
      setError("리포트 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      setLoading(false);
      return;
    }
    const nextTimezone = profileResult.data.timezone || "Asia/Seoul";
    const synced = await syncRecurringItemDates(client, session.user.id, (itemResult.data || []) as ManagedItem[], nextTimezone);
    setItems(synced.items);
    if (synced.failedCount) setError("일부 반복 결제의 다음 결제일을 갱신하지 못했어요. 잠시 후 다시 시도해 주세요.");
    setEvents((eventResult.data || []) as ReportEvent[]);
    setRelations((relationResult.data || []) as SubscriptionRelationship[]);
    setPeriods((periodResult.data || []) as PricePeriod[]);
    setStatusHistory((historyResult.data || []) as ItemStatusHistory[]);
    setPaymentRecords(paymentRecordResult.error ? [] : (paymentRecordResult.data || []) as PaymentRecord[]);
    const nextCurrency = profileResult.data.default_currency || "KRW";
    setTimezone(nextTimezone);
    setDefaultCurrency(nextCurrency);
    setReportCurrency(nextCurrency);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [client, session]);

  const today = todayInTimeZone(timezone);
  const reportEvents = useMemo(() => {
    const existing = new Set(events.map((event) => `${event.item_id}:${event.event_date}`));
    const historical = buildCalendarEvents(items, start, end)
      .filter((event) => event.kind === "payment" && event.date < today)
      .filter((event) => !existing.has(`${event.itemId}:${event.date}`))
      .map((event) => ({
        id: event.key,
        item_id: event.itemId,
        event_type: "payment",
        event_date: event.date,
        amount: event.amount,
        currency: event.currency,
        schedule_status: "scheduled" as const,
      } satisfies ReportEvent));
    return [...events, ...historical];
  }, [events, items, start, end, today]);
  const summary = useMemo(
    () => summarizeReport(reportEvents, relations, start, end, today, paymentRecords),
    [reportEvents, relations, start, end, today, paymentRecords],
  );
  const orderCurrencies = (values: Record<string, number>) => Object.entries(values).sort(([left], [right]) => {
    if (left === currency) return -1;
    if (right === currency) return 1;
    return left.localeCompare(right);
  });
  const displayCurrencies = (values: Record<string, number>) => ({
    [currency]: values[currency] ?? 0,
    ...values,
  });
  const renderCurrencyValues = (values: Record<string, number>) => {
    const ordered = orderCurrencies(displayCurrencies(values));
    const primary = ordered.find(([code]) => code === currency) || [currency, 0] as [string, number];
    const secondary = ordered.filter(([code]) => code !== currency);
    return <div className="currency-values"><strong className="currency-primary">{money(primary[1], primary[0])}</strong>{secondary.length ? <span className="currency-secondary">{secondary.map(([code, value], index) => <Fragment key={code}>{index ? <i aria-hidden="true">·</i> : null}<strong>{money(value, code)}</strong></Fragment>)}</span> : null}</div>;
  };
  const expiryCounts = useMemo(() => {
    const expiryTypes = new Set(["gifticon", "coupon", "voucher", "points", "warranty", "other_deadline", "fixed_term_membership"]);
    const dated = items.flatMap((item) => {
      const date = item.target_date_value;
      return expiryTypes.has(item.management_type) && item.target_date_precision === "day" && date && date >= start && date <= end
        ? [date]
        : [];
    });
    const past = dated.filter((date) => date < today).length;
    return { past, upcoming: dated.length - past };
  }, [items, start, end, today]);
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>(".report-summary-grid .currency-summary");
    const plannedNote = cards[1]?.querySelector("small");
    if (plannedNote) plannedNote.textContent = end < today ? "종료일이 현재보다 이전일 경우 금액이 나오지 않습니다." : `${end}까지의 결제 예정 금액입니다.`;
    const expiryNote = cards[2]?.querySelector("small");
    if (expiryNote) expiryNote.textContent = `기한 지남 ${expiryCounts.past}건 · 만료 예정 ${expiryCounts.upcoming}건`;
  }, [end, today, expiryCounts.past, expiryCounts.upcoming]);
  const rows = useMemo(
    () => buildMetricRows(items, relations, periods, currency, today),
    [items, relations, periods, currency, today],
  );
  const periodDays = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  const dailyView = periodDays <= 31;
  const periodPoints = useMemo(
    () => dailyView
      ? buildDailyBreakdown(reportEvents, relations, start, end, today, currency)
      : buildMonthlyBreakdown(reportEvents, relations, start, end, today, currency),
    [dailyView, reportEvents, relations, start, end, today, currency],
  );
  const selected = rows.find((row) => row.item.id === selectedId) || null;
  const parentOptions = items.filter((item) => isPaymentScheduleType(item.management_type));
  const itemName = (id: string | null) => items.find((item) => item.id === id)?.service_name || "항목 확인 필요";
  const knownRows = useMemo(
    () => rows
      .filter((row) => metricValue(row, metric) !== null)
      .sort((a, b) => (metricValue(b, metric) || 0) - (metricValue(a, metric) || 0)),
    [rows, metric],
  );
  const unknownRows = useMemo(
    () => rows.filter((row) => metricValue(row, metric) === null),
    [rows, metric],
  );
  const maximum = Math.max(1, ...knownRows.map((row) => metricValue(row, metric) || 0));
  const bubbleItems = useMemo<BubbleChartItem[]>(
    () => knownRows.map((row) => {
      const value = metricValue(row, metric) || 0;
      return {
        id: row.item.id,
        name: row.item.service_name,
        logoUrl: row.item.brand_logo_url,
        brandDomain: row.item.brand_domain,
        value,
        valueText: metric === "months" ? `${value.toFixed(1)}개월` : money(value, currency),
      };
    }),
    [knownRows, metric, currency],
  );
  const periodPast = periodPoints.reduce((sum, point) => sum + point.past, 0);
  const periodFuture = periodPoints.reduce((sum, point) => sum + point.future, 0);
  const periodTotal = periodPast + periodFuture;
  const periodHasKnownAmount = periodPoints.some((point) => point.count > 0);
  const periodMaximum = Math.max(1, ...periodPoints.map((point) => point.total));
  const linePoints = periodPoints.map((point, index) => {
    const x = periodPoints.length <= 1 ? 50 : (index / (periodPoints.length - 1)) * 100;
    const y = 92 - (point.total / periodMaximum) * 80;
    return `${x},${y}`;
  }).join(" ");
  const foreignCurrencyRows = Object.keys({ ...summary.pastByCurrency, ...summary.remainingByCurrency })
    .filter((code) => code !== currency)
    .map((code) => ({ code, past: summary.pastByCurrency[code] || 0, future: summary.remainingByCurrency[code] || 0 }))
    .filter((row) => row.past !== 0 || row.future !== 0)
    .sort((left, right) => left.code.localeCompare(right.code));
  const foreignPeriodRows = foreignCurrencyRows.flatMap((row) => {
    const points = dailyView
      ? buildDailyBreakdown(reportEvents, relations, start, end, today, row.code)
      : buildMonthlyBreakdown(reportEvents, relations, start, end, today, row.code);
    return points.map((point) => ({ ...point, code: row.code }));
  });
  const foreignCard = <article className="period-amount-card foreign-enhanced-card"><h3>선택 기간 전체 청구액(외화)</h3>{foreignCurrencyRows.length ? <>{foreignCurrencyRows.map((row) => { const total = row.past + row.future; return <div className="foreign-currency-summary" key={row.code}><strong>{row.code} {new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(total)}</strong><div className="stacked-bar" aria-label={`${row.code} 지난 예정액 ${row.past}, 미래 예정액 ${row.future}`}><i className="past-color" style={{ width: total ? `${row.past / total * 100}%` : "0%" }} /><i className="future-color" style={{ width: total ? `${row.future / total * 100}%` : "0%" }} /></div><p><span>지난 예정액 <b>{row.past.toLocaleString("ko-KR")}</b></span><span>미래 예정액 <b>{row.future.toLocaleString("ko-KR")}</b></span></p></div>; })}<button type="button" className="breakdown-toggle" aria-expanded={showForeignBreakdown} onClick={() => setShowForeignBreakdown((current) => !current)}>{showForeignBreakdown ? "상세 내역 닫기" : "상세 내역 보기"}</button>{showForeignBreakdown ? <table><thead><tr><th>{dailyView ? "일" : "월"}</th><th>통화</th><th>지난 예정액</th><th>미래 예정액</th><th>전체</th></tr></thead><tbody>{foreignPeriodRows.map((point) => <tr key={`${point.code}:${point.month}`}><td>{point.month}</td><td>{point.code}</td><td>{point.past.toLocaleString("ko-KR")}</td><td>{point.future.toLocaleString("ko-KR")}</td><td>{point.total.toLocaleString("ko-KR")}</td></tr>)}</tbody></table> : null}</> : null}</article>;
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".foreign-currency-row").forEach((row, index) => {
      const item = foreignCurrencyRows[index];
      const total = item ? item.past + item.future : 0;
      row.style.setProperty("--past-share", `${total ? item!.past / total * 100 : 0}%`);
    });
  }, [foreignCurrencyRows]);

  async function saveRelationship() {
    if (!client || !session || !parentId || !childId || parentId === childId) {
      setError("서로 다른 상위 구독과 이용 서비스를 선택해 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    const costItemId = relationshipType === "included_benefit"
      ? parentId
      : relationshipType === "additional_charge"
        ? childId
        : null;
    const result = await client.from("subscription_relationships").upsert({
      user_id: session.user.id,
      parent_item_id: parentId,
      child_item_id: childId,
      relationship_type: relationshipType,
      cost_item_id: costItemId,
    }, { onConflict: "user_id,child_item_id" }).select().single();
    setSaving(false);
    if (result.error) {
      setError("결합 관계를 저장하지 못했어요. 연결 항목을 확인해 주세요.");
      return;
    }
    await load();
  }

  async function removeRelationship(id: string) {
    if (!client || !session) return;
    setSaving(true);
    const result = await client.from("subscription_relationships").delete().eq("id", id).eq("user_id", session.user.id);
    setSaving(false);
    if (result.error) setError("결합 관계를 해제하지 못했어요.");
    else await load();
  }

  async function setScheduleStatus(eventId: string, status: "scheduled" | "cancelled" | "skipped") {
    if (!client) return;
    const result = await client.rpc("set_calendar_event_schedule_status", { p_event_id: eventId, p_status: status });
    if (result.error) setError("회차 상태를 변경하지 못했어요.");
    else setEvents((current) => current.map((event) => event.id === eventId ? { ...event, schedule_status: status } : event));
  }

  if (loading) return <div className="app-shell">{navigation}<main className="report-state">리포트를 계산하는 중…</main></div>;

  return (
    <div className="app-shell">
      {navigation}
      <main className="report-page">
        <PageHeader eyebrow="리포트" title="지출 리포트" description="예상 지출과 구독 현황을 확인하세요." actions={<small className="page-header-context">기준일 · {today} · {timezone}</small>} />
        {error ? <div className="notice error" role="alert">{error}</div> : null}

        <section className="report-period-shell">
        <section className="report-controls" aria-label="리포트 기간">
          <label>시작일<input type="date" required value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label>
          <label>종료일<input type="date" required value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label>
          <p>시작일과 종료일을 모두 포함해요. 남은 예정액에는 오늘 일정도 포함합니다.</p>
        </section>

        <h2 className="report-results-title">{start} ~ {end} 리포트</h2>

        <section className="report-summary-grid">
          <article className="report-card currency-summary"><span>기간 내 결제한 금액</span>{renderCurrencyValues(summary.pastByCurrency)}<small>{start > today && end > today ? "종료일이 현재보다 이후일 경우 금액이 나오지 않습니다." : "등록 기준 금액이며 실제 금액과 다를 수 있습니다."}</small></article>
          <article className="report-card currency-summary"><span>기간 내 결제 예정 금액</span>{renderCurrencyValues(summary.remainingByCurrency)}<small>{end < today ? "종료일이 현재보다 이전일 경우 금액이 나오지 않습니다." : `오늘을 포함한 ${end}까지의 결제 예정 금액입니다.`}</small></article>
          <article className="report-card currency-summary exclusions"><span>선택 기간 내 기한 만료 일정</span><div className="currency-values"><strong className="currency-primary">{expiryCounts.past + expiryCounts.upcoming}건</strong></div><small>기간 지난 {expiryCounts.past}건 · 만료 예정 {expiryCounts.upcoming}건</small></article>
        </section>

        <section className="report-panel period-visualization">
          <header><div><h2>{start} ~ {end} 금액 그래프</h2></div><div className="period-legend"><span><i className="past-color" />지난 예정액</span><span><i className="future-color" />미래 결제 예정액</span></div></header>
          <article className="monthly-line-card">
            <h3>월별 증감</h3>
            {periodHasKnownAmount ? <div className="line-chart"><svg viewBox="0 0 100 100" role="img" aria-label={`${dailyView ? "일별" : "월별"} 예정 청구액 라인 차트`} preserveAspectRatio="none"><polyline points={linePoints} /></svg><div>{periodPoints.map((point) => <span key={point.month}><i style={{ height: `${Math.max(2, point.total / periodMaximum * 100)}%` }} /><small>{dailyView ? point.month.slice(5).replace("-", ".") : point.month.slice(2).replace("-", ".")}</small></span>)}</div></div> : <p className="report-empty">선택한 통화로 계산할 일정이 없어요.</p>}
          </article>
          <div className="period-comparison-grid">
            <article className="period-amount-card"><h3>선택 기간 전체 청구액</h3><strong>{periodHasKnownAmount ? money(periodTotal, currency) : "계산할 정보 없음"}</strong><div className="stacked-bar" aria-label={`지난 예정액 ${money(periodPast, currency)}, 미래 결제 예정액 ${money(periodFuture, currency)}`}><i className="past-color" style={{ width: periodTotal ? `${periodPast / periodTotal * 100}%` : "0%" }} /><i className="future-color" style={{ width: periodTotal ? `${periodFuture / periodTotal * 100}%` : "0%" }} /></div><p><span>지난 예정액 <b>{money(periodPast, currency)}</b></span><span>미래 예정액 <b>{money(periodFuture, currency)}</b></span></p><button type="button" className="breakdown-toggle" aria-expanded={showPeriodBreakdown} onClick={() => setShowPeriodBreakdown((current) => !current)}>{showPeriodBreakdown ? "상세 내역 닫기" : "상세 내역 보기"}</button>{showPeriodBreakdown ? <table><thead><tr><th>{dailyView ? "일" : "월"}</th><th>지난 예정액</th><th>미래 예정액</th><th>전체</th></tr></thead><tbody>{periodPoints.map((point) => <tr key={point.month}><td>{point.month}</td><td>{money(point.past, currency)}</td><td>{money(point.future, currency)}</td><td>{money(point.total, currency)}</td></tr>)}</tbody></table> : null}</article>
            <article className="period-amount-card"><h3>기간 중 남은 예정 청구액</h3><strong>{periodHasKnownAmount ? money(periodFuture, currency) : "계산할 정보 없음"}</strong><div className="single-bar"><i className="future-color" style={{ width: periodTotal ? `${periodFuture / periodTotal * 100}%` : "0%" }} /></div><p><span>오늘 포함 미래 일정 <b>{periodHasKnownAmount ? money(periodFuture, currency) : "확인 필요"}</b></span></p><table><thead><tr><th>{dailyView ? "일" : "월"}</th><th>남은 예정액</th></tr></thead><tbody>{periodPoints.filter((point) => point.future > 0).map((point) => <tr key={point.month}><td>{point.month}</td><td>{money(point.future, currency)}</td></tr>)}</tbody></table></article>
          </div>
          <article className="period-amount-card foreign-amount-card"><h3>선택 기간 전체 청구액(외화)</h3>{foreignCurrencyRows.length ? <>{foreignCurrencyRows.map((row) => <div className="foreign-currency-row" key={row.code}><strong>{row.code} {new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(row.past + row.future)}</strong><span>지난 예정액 {row.past.toLocaleString("ko-KR")} · 미래 예정액 {row.future.toLocaleString("ko-KR")}</span></div>)}<button type="button" className="breakdown-toggle" aria-expanded={showForeignBreakdown} onClick={() => setShowForeignBreakdown((current) => !current)}>{showForeignBreakdown ? "상세 내역 닫기" : "상세 내역 보기"}</button>{showForeignBreakdown ? <table><thead><tr><th>통화</th><th>지난 예정액</th><th>미래 예정액</th><th>전체</th></tr></thead><tbody>{foreignCurrencyRows.map((row) => <tr key={row.code}><td>{row.code}</td><td>{row.past.toLocaleString("ko-KR")}</td><td>{row.future.toLocaleString("ko-KR")}</td><td>{(row.past + row.future).toLocaleString("ko-KR")}</td></tr>)}</tbody></table> : null}</> : null}</article>
          {foreignCard}
          {showForeignBreakdown ? <div className="foreign-breakdown-modal" role="dialog" aria-modal="true" aria-label="외화 청구액 상세 내역" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForeignBreakdown(false); }}><div className="foreign-breakdown-dialog"><header><h3>외화 청구액 상세 내역</h3><button type="button" onClick={() => setShowForeignBreakdown(false)} aria-label="상세 내역 닫기">×</button></header><div className="foreign-breakdown-scroll"><table><thead><tr><th>{dailyView ? "일" : "월"}</th><th>통화</th><th>지난 예정액</th><th>미래 예정액</th><th>전체</th></tr></thead><tbody>{foreignPeriodRows.map((point) => <tr key={`modal:${point.code}:${point.month}`}><td>{point.month}</td><td>{point.code}</td><td>{point.past.toLocaleString("ko-KR")}</td><td>{point.future.toLocaleString("ko-KR")}</td><td>{point.total.toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div></div></div> : null}
          <small className="past-disclaimer">리포트 결과는 등록된 금액 기준으로 작성되었으며, 실제 금액과 다를 수 있습니다.</small>
        </section>

        <details className="report-panel schedule-manager">
          <summary>선택 기간 회차 제외 관리</summary>
          <p>실제 결제를 확정하는 기능이 아니라 예정 합계에서 취소·건너뜀 회차를 제외하는 설정이에요.</p>
          <div>
            {reportEvents.filter((event) => event.event_type === "payment" && event.event_date >= start && event.event_date <= end).slice(0, 24).map((event) => (
              <label key={event.id}>
                <span>{event.event_date} · {itemName(event.item_id)}</span>
                <select value={event.schedule_status || "scheduled"} onChange={(change) => void setScheduleStatus(event.id, change.target.value as "scheduled" | "cancelled" | "skipped")}>
                  <option value="scheduled">예정</option><option value="cancelled">취소</option><option value="skipped">건너뜀</option>
                </select>
              </label>
            ))}
          </div>
        </details>
        </section>

        <section className="report-layout">
          <article className="report-panel relationship-panel">
            <header><h2>결합 구독</h2><p>상위 구독과 이용 서비스를 연결하고 비용 귀속을 한 곳으로 정해요.</p></header>
            <div className="relationship-form">
              <label>상위 구독<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">선택</option>{parentOptions.map((item) => <option key={item.id} value={item.id}>{item.service_name}</option>)}</select></label>
              <label>이용 서비스<select value={childId} onChange={(event) => setChildId(event.target.value)}><option value="">선택</option>{items.filter((item) => item.id !== parentId).map((item) => <option key={item.id} value={item.id}>{item.service_name}</option>)}</select></label>
              <label>관계<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as RelationshipType)}><option value="included_benefit">포함된 혜택</option><option value="additional_charge">추가 요금</option><option value="unknown_cost">금액 미확인 연결</option></select></label>
              <button type="button" className="button primary" onClick={saveRelationship} disabled={saving}>관계 저장</button>
            </div>
            <div className="relationship-list">
              {relations.length ? relations.map((relation) => <div key={relation.id}><span><b>{itemName(relation.parent_item_id)} → {itemName(relation.child_item_id)}</b><small>{relationLabel(relation.relationship_type)} · 비용 귀속 {relation.cost_item_id ? itemName(relation.cost_item_id) : "금액 미확인"}</small></span><button type="button" onClick={() => removeRelationship(relation.id)} disabled={saving}>연결 해제</button></div>) : <p className="report-empty">등록된 결합 관계가 없어요. 각 항목은 직접 결제로 계산됩니다.</p>}
            </div>
          </article>

          <article className="report-panel visualization-panel">
            <header><div><h2>전체 리포트</h2><p>첫 기록부터 지금까지의 내역을 정리했어요.</p></div><div className="report-selectors"><select aria-label="표시 통화" value={reportCurrency} onChange={(event) => setReportCurrency(event.target.value)} disabled={metric === "months"}><option value="KRW">KRW · 원화</option><option value="USD">USD · 달러</option><option value="EUR">EUR · 유로</option><option value="JPY">JPY · 엔화</option><option value="GBP">GBP · 파운드</option></select><select aria-label="지표 기준" value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}><option value="months">구독 개월 수</option><option value="accumulated">누적 금액</option><option value="monthly">이번 달 결제 금액</option></select></div></header>
            <div className="view-tabs" role="tablist">{(["bubble", "chart", "table"] as const).map((mode) => <button type="button" role="tab" aria-selected={view === mode} className={view === mode ? "active" : ""} key={mode} onClick={() => setView(mode)}>{mode === "bubble" ? "버블 차트" : mode === "chart" ? "그래프" : "표"}</button>)}</div>
            {view === "bubble" ? <BubbleForceChart items={bubbleItems} selectedId={selectedId} onSelect={(id) => setSelectedId((current) => current === id ? "" : id)} /> : view === "chart" ? <div className="bar-chart">{knownRows.map((row) => { const value = metricValue(row, metric) || 0; return <button type="button" key={row.item.id} onClick={() => setSelectedId(row.item.id)}><span>{row.item.service_name}</span><i style={{ width: `${Math.max(3, value / maximum * 100)}%` }} /><strong>{metric === "months" ? `${value.toFixed(1)}개월` : money(value, currency)}</strong></button>; })}</div> : <div className="report-table-wrap"><table><thead><tr><th>서비스</th><th>관계</th><th>값</th></tr></thead><tbody>{knownRows.map((row) => <tr key={row.item.id} tabIndex={0} onClick={() => setSelectedId(row.item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(row.item.id); } }}><td>{row.item.service_name}</td><td>{row.relationship ? relationLabel(row.relationship.relationship_type) : "직접 결제"}</td><td>{metric === "months" ? `${(metricValue(row, metric) || 0).toFixed(1)}개월` : money(metricValue(row, metric) || 0, currency)}</td></tr>)}</tbody></table></div>}
            {unknownRows.length ? <div className="unknown-group"><b>비용 비교 제외·미확인</b><span>{unknownRows.map((row) => row.item.service_name).join(" · ")}</span><small>{metric === "accumulated" ? "비용이 상위 구독에 귀속됐거나 Phase 6 도입 이후 기록된 가격 구간이 부족해요." : "비용이 다른 항목에 귀속됐거나 금액·주기·시작일을 확인할 수 없어요."}</small></div> : null}
            {selected ? <aside className="visual-detail"><h3>{selected.item.service_name}</h3><p>{selected.item.plan_name || "요금제 미입력"} · {selected.relationship ? relationLabel(selected.relationship.relationship_type) : "직접 결제"}</p><dl><div><dt>다음 결제일</dt><dd>{selected.item.target_date_value || "확인 필요"}</dd></div><div><dt>월 환산액</dt><dd>{selected.monthlyEquivalent === null ? "계산할 정보 없음" : money(selected.monthlyEquivalent, currency)}</dd></div><div><dt>추정 누적액</dt><dd>{selected.estimatedAccumulated === null ? "계산할 정보 없음" : money(selected.estimatedAccumulated, currency)}</dd></div><div><dt>구독 기간</dt><dd>{selected.subscribedMonths === null ? "확인 필요" : `${selected.subscribedMonths.toFixed(1)}개월`}</dd></div></dl><small>누적액은 기록된 가격 구간에 월 30.4375일·연 365.2425일을 적용한 참고값입니다.</small><div className="status-history"><b>이용 상태 이력</b>{statusHistory.filter((history) => history.item_id === selected.item.id).slice(0, 5).map((history) => <span key={history.id}>{history.occurred_on} · {history.event_type === "tracking_started" ? "이력 기록 시작" : history.event_type === "paused" ? "일시 중지" : history.event_type === "ended" ? "이용 종료" : history.event_type === "resumed" ? "재이용" : "상태 변경"}</span>)}{statusHistory.every((history) => history.item_id !== selected.item.id) ? <span>기록된 이력이 없어요.</span> : null}</div></aside> : <p className="report-empty">표시할 구독이 없어요.</p>}
          </article>
        </section>
      </main>
    </div>
  );
}
