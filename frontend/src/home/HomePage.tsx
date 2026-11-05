import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { getAnnouncements, getCollectionStatus, getRelevantNews, type CollectionStatus, type OperatorAnnouncement, type ServiceNews } from "../lib/api";
import { syncRecurringItemDates } from "../lib/recurringItems";
import { displayDate, typeLabel, type ManagedItem } from "../phase3/model";
import { GlassCard, PageHeader } from "../components/ui";
import galleryIcon from "../assets/figma/gallery.svg";
import {
  buildHomeSchedule,
  daysBetween,
  needsHomeReview,
  selectUpcomingEvents,
  summarizeNext30Days,
  todayInTimeZone,
  type HomeEventKind,
  type HomeScheduleEvent,
} from "./homeModel";
import "./home.css";

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}

function money(value: number, currency: string, useCurrencyCode = false) {
  const amount = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
  return currency === "KRW" && !useCurrencyCode ? `${amount}원` : `${currency} ${amount}`;
}

function eventAmount(event: HomeScheduleEvent) {
  if (event.amount === null || !event.currency) return null;
  return money(event.amount, event.currency);
}

function cycleText(cycle: HomeScheduleEvent["billingCycle"]) {
  return cycle === "monthly" ? "매월" : cycle === "yearly" ? "매년" : "기타 주기";
}

function eventSubtitle(event: HomeScheduleEvent) {
  if (event.kind === "payment") {
    const cycle = cycleText(event.billingCycle);
    return event.planName ? `${event.planName} · ${cycle}` : cycle;
  }
  const type = typeLabel(event.managementType);
  return event.providerName ? `${type} · ${event.providerName}` : type;
}

function ReviewPanel({
  items,
  visibleItems,
  page,
  pageCount,
  onPage,
}: {
  items: ManagedItem[];
  visibleItems: ManagedItem[];
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  return (
    <section className="home-card review-card home-review-section">
      <div className="home-card-header">
        <div>
          <div className="review-top-line">
            <div className="review-label-line"><span className="section-label">확인 필요</span><span className="review-count">{items.length}건</span></div>
            {items.length > 2 ? (
              <div className="review-navigation" aria-label="확인 필요 항목 페이지 이동">
                <button type="button" aria-label="이전 항목" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</button>
                <button type="button" aria-label="다음 항목" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>›</button>
              </div>
            ) : null}
          </div>
          <h2>일정과 금액을 완성해 주세요</h2><p>정보를 보완하면 예정 금액과 알림이 더 정확해져요.</p>
        </div>
      </div>
      <div className="review-list">
        {items.length ? visibleItems.map((item) => (
          <Link to={`/items/${item.id}/edit`} className="review-row" key={item.id}><span><b>{item.service_name}</b><small>{!item.target_date_value || item.target_date_precision !== "day" ? "정확한 날짜 확인 필요" : "금액·통화 확인 필요"}</small></span><strong>보완하기 →</strong></Link>
        )) : <div className="home-empty compact">지금은 확인할 항목이 없어요.</div>}
      </div>
    </section>
  );
}

function monthShift(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function calendarDates(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - leading));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function UnifiedHomePage({ navigation }: { navigation: ReactNode }) {
  const { client, session } = useAuth();
  const [items, setItems] = useState<ManagedItem[]>([]);
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [defaultCurrency, setDefaultCurrency] = useState("KRW");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | HomeEventKind>("all");
  const [reviewPage, setReviewPage] = useState(0);
  const today = todayInTimeZone(timezone);
  const [calendarMonth, setCalendarMonth] = useState(() => today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState("");
  const [news, setNews] = useState<ServiceNews[]>([]);
  const [newsState, setNewsState] = useState<"loading" | "ready" | "error">("loading");
  const [announcements, setAnnouncements] = useState<OperatorAnnouncement[]>([]);
  const [collectionStatus, setCollectionStatus] = useState<CollectionStatus | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([getRelevantNews(session.access_token), getCollectionStatus(session.access_token)])
      .then(([rows, status]) => { const byService = new Map<string, ServiceNews>(); rows.forEach((row) => { const key = row.service_name || row.catalog_id; if (!byService.has(key)) byService.set(key, row); }); setNews([...byService.values()].slice(0, 3)); setCollectionStatus(status); setNewsState("ready"); })
      .catch(() => setNewsState("error"));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    getAnnouncements(session.access_token).then((rows) => setAnnouncements(rows.slice(0, 3))).catch(() => setAnnouncements([]));
  }, [session]);

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    setLoading(true);
    Promise.all([
      client.from("items").select("*").eq("user_id", session.user.id),
      client.from("profiles").select("timezone,default_currency").eq("id", session.user.id).single(),
    ]).then(async ([itemResult, profileResult]) => {
      if (!active) return;
      if (itemResult.error || profileResult.error || !profileResult.data) {
        setError("홈 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        setLoading(false);
        return;
      }
      const zone = profileResult.data.timezone || "Asia/Seoul";
      const synced = await syncRecurringItemDates(client, session.user.id, (itemResult.data || []) as ManagedItem[], zone);
      if (!active) return;
      setItems(synced.items);
      if (synced.failedCount) setError("일부 반복 결제의 다음 결제일을 갱신하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setTimezone(zone);
      setDefaultCurrency(profileResult.data.default_currency || "KRW");
      setCalendarMonth(todayInTimeZone(zone).slice(0, 7));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [client, session]);

  const events = useMemo(() => buildHomeSchedule(items, today), [items, today]);
  const summary = useMemo(() => summarizeNext30Days(events, today), [events, today]);
  const upcoming = selectUpcomingEvents(events, filter);
  const reviewItems = items.filter(needsHomeReview);
  const reviewPageCount = Math.ceil(reviewItems.length / 2);
  const visibleReviewItems = reviewItems.slice(reviewPage * 2, reviewPage * 2 + 2);
  const dateEvents = selectedDate
    ? events.filter((event) => event.date === selectedDate)
    : [];
  const dates = calendarDates(calendarMonth);
  const currentMonthNumber = Number(calendarMonth.slice(5));
  const currentMonthYear = Number(calendarMonth.slice(0, 4));

  useEffect(() => {
    setReviewPage((page) => Math.min(page, Math.max(0, reviewPageCount - 1)));
  }, [reviewPageCount]);

  if (loading)
    return (
      <div className="app-shell">
        {navigation}
        <main className="home-loading">통합 홈을 불러오는 중…</main>
      </div>
    );

  return (
    <div className="app-shell">
      {navigation}
      <main className="unified-home">
        <PageHeader eyebrow="오늘의 달리" title={<><span className="home-title-line">달마다 돌아오는</span>{" "}<span className="home-title-line">구독 · 기한 관리</span></>} description="이번 달 구독과 기한을 한눈에 확인하세요." mascot="moon" actions={<div className="home-actions"><Link to="/items/new" className="button primary">＋ 등록</Link><Link to="/images" className="button secondary"><img className="button-icon" src={galleryIcon} alt="" />이미지 관리</Link></div>} />

        {error ? <div className="notice error" role="alert">{error}</div> : null}
        {announcements.length ? <section className="home-announcements" aria-label="운영 공지사항"><h2>공지사항</h2>{announcements.map((entry) => <article key={entry.id}><div><strong>{entry.title}</strong><small>{entry.published_at?.slice(0, 10) || entry.created_at.slice(0, 10)}</small></div><p>{entry.body}</p></article>)}</section> : null}
        {!error ? (
          <>
            <GlassCard as="section" className="home-overview-panel" aria-label="다음 30일 요약">
              <article className="home-summary-card primary-summary">
                <span>앞으로 30일 예정 금액</span>
                <strong>{money(summary.totals[defaultCurrency] || 0, defaultCurrency)}</strong>
                {Object.entries(summary.totals).some(([currency]) => currency !== defaultCurrency) ? (
                  <small className="foreign-total-line">
                    {Object.entries(summary.totals)
                      .filter(([currency]) => currency !== defaultCurrency)
                      .map(([currency, value]) => money(value, currency, true))
                      .join(" · ")}
                  </small>
                ) : null}
                <div className="primary-summary-notes">
                  <p>날짜 · 금액 미확인 제외</p>
                  <p>등록된 일정 기준 예상 금액 · 실제 결제 내역 아님</p>
                </div>
              </article>
              <div className="home-overview-metrics">
                <article className="home-summary-card">
                  <span>결제 예정</span>
                  <strong>{summary.paymentCount}<small>건</small></strong>
                  <p>{displayDate(summary.end, "day")}까지</p>
                </article>
                <article className="home-summary-card">
                  <span>기한 만료 예정</span>
                  <strong>{summary.benefitCount}<small>건</small></strong>
                  <p>30일 이내의 기프티콘, 쿠폰, 상품권, 포인트, 보증, 기타 기한</p>
                </article>
              </div>
            </GlassCard>

            <section className="home-main-grid">
              <article className="home-card upcoming-card">
                <div className="home-card-header">
                  <div><h2>다가오는 기한</h2><p>30일 제한 없이 가까운 일정 최대 6개</p></div>
                  <div className="schedule-filters" aria-label="일정 유형 필터">
                    {(["all", "payment", "benefit"] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        className={filter === value ? "active" : ""}
                        onClick={() => setFilter(value)}
                      >
                        {value === "all" ? "전체" : value === "payment" ? "결제" : "혜택"}
                      </button>
                    ))}
                  </div>
                </div>
                {upcoming.length ? (
                  <div className="upcoming-list">
                    {upcoming.map((event) => {
                      const dday = daysBetween(today, event.date);
                      const amount = eventAmount(event);
                      return (
                        <button key={event.key} type="button" className="upcoming-row" onClick={() => navigate(`/items/${event.itemId}`)}>
                          <span className="upcoming-date"><b>{event.date.slice(5).replace("-", ".")}</b><small>{event.kind === "payment" ? "결제" : "만료"}</small></span>
                          <span className="upcoming-identity">
                            <i aria-hidden="true">{event.name.trim().slice(0, 1).toUpperCase() || "?"}</i>
                            <span className="upcoming-name"><b>{event.name}</b><small>{eventSubtitle(event)}</small></span>
                          </span>
                          <span className={`upcoming-payment${amount === null ? " no-amount" : ""}`}>
                            {amount !== null ? <strong>{amount}</strong> : null}
                            <small className={`event-kind ${event.kind}`}>{event.kind === "payment" ? "결제 예정" : "기한 만료 예정"}</small>
                          </span>
                          <em className={dday <= 3 ? "urgent" : dday <= 7 ? "soon" : ""}>{dday === 0 ? "D-day" : `D-${dday}`}</em>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="home-empty">{filter === "payment" ? "다가오는 결제 일정이 없어요." : filter === "benefit" ? "다가오는 기한 만료 예정 일정이 없어요." : "다가오는 일정이 없어요."}</div>
                )}
                <Link to="/items" className="home-list-link">전체 목록 보기 →</Link>
              </article>

              <aside className="home-side-column">
                <section className="home-card mini-calendar-card">
                  <div className="calendar-heading">
                    <button type="button" aria-label="이전 달" onClick={() => { setCalendarMonth(monthShift(calendarMonth, -1)); setSelectedDate(""); }}>‹</button>
                    <h2>{currentMonthYear}년 {currentMonthNumber}월</h2>
                    <button type="button" aria-label="다음 달" onClick={() => { setCalendarMonth(monthShift(calendarMonth, 1)); setSelectedDate(""); }}>›</button>
                  </div>
                  <div className="calendar-weekdays">{["월", "화", "수", "목", "금", "토", "일"].map((day) => <span key={day}>{day}</span>)}</div>
                  <div className="calendar-days">
                    {dates.map((date) => {
                      const dayEvents = events.filter((event) => event.date === date);
                      return (
                        <button
                          type="button"
                          key={date}
                          className={`${date.slice(0, 7) !== calendarMonth ? "outside " : ""}${date === today ? "today " : ""}${date === selectedDate ? "selected" : ""}`}
                          onClick={() => setSelectedDate(date)}
                        >
                          <span>{Number(date.slice(8))}</span>
                          <i>{dayEvents.some((event) => event.kind === "payment") ? <b className="payment-dot" /> : null}{dayEvents.some((event) => event.kind === "benefit") ? <b className="benefit-dot" /> : null}</i>
                        </button>
                      );
                    })}
                  </div>
                  <div className="calendar-legend"><div><span><i className="payment-dot" /> 결제</span><span><i className="benefit-dot" /> 기한 만료</span></div><Link to="/calendar" className="calendar-full-link">전체 캘린더 보기 →</Link></div>
                  {selectedDate ? (
                    <div className="selected-date-panel">
                      <strong>{displayDate(selectedDate, "day")}</strong>
                      {dateEvents.length ? dateEvents.map((event) => (
                        <button className="selected-date-event" type="button" key={event.key} onClick={() => navigate(`/items/${event.itemId}`)}>
                          <i className={event.kind === "payment" ? "payment-dot" : "benefit-dot"} aria-hidden="true" />
                          <span>{event.name} · {event.kind === "payment" ? "결제" : "기한 만료"}</span>
                        </button>
                      )) : <span className="selected-date-empty">이 날짜에 등록된 일정이 없어요.</span>}
                    </div>
                  ) : null}
                </section>
                <ReviewPanel items={reviewItems} visibleItems={visibleReviewItems} page={reviewPage} pageCount={reviewPageCount} onPage={setReviewPage} />
              </aside>
            </section>

            <section className="home-news-section">
              <div className="home-card-header"><div><h2>내 구독의 최신 소식</h2><p>검수된 공식 출처 중 내 서비스와 연결된 소식이에요.</p></div><Link to="/news" className="home-list-link">전체 소식 보기 →</Link></div>
              {newsState === "loading" ? <div className="home-card home-empty news-empty">최신 소식을 불러오는 중…</div> : newsState === "error" ? <div className="home-card home-empty news-empty"><strong>소식을 불러오지 못했어요</strong><span>일정과 관리 데이터는 그대로 사용할 수 있어요.</span></div> : news.length ? <div className="home-news-grid">{news.map((entry) => <Link key={entry.id} to="/news" className="home-card home-news-card"><span>{entry.service_name}</span><strong>{entry.title}</strong><small>{entry.applicability_status === "needs_confirmation" ? "적용 조건 확인 필요" : `적용일 ${entry.applies_on || "확인 필요"}`}</small></Link>)}</div> : <div className="home-card home-empty news-empty"><strong>{collectionStatus?.status === "no_subscriptions" ? "수집할 반복 구독이 없어요" : collectionStatus?.status === "no_new_content" || collectionStatus?.status === "unchanged" ? "확인한 범위에서 새 소식이 없어요" : collectionStatus?.status === "precheck_failed" ? "공식 출처 확인에 실패했어요" : collectionStatus?.status === "search_failed" ? "소식 검색에 실패했어요" : collectionStatus?.status === "source_failed" ? "공식 원문을 확인하지 못했어요" : collectionStatus?.status === "budget_limited" ? "오늘 검색 예산에 도달했어요" : collectionStatus?.configured ? "첫 소식 수집을 기다리고 있어요" : "자동 소식 수집 설정이 필요해요"}</strong><span>{collectionStatus?.last_checked_at ? `마지막 확인 ${collectionStatus.last_checked_at.slice(0, 10)}` : "반복 구독 서비스별 공통 수집 결과를 여기에 표시합니다."}</span></div>}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
