import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { displayDate, typeLabel, type ManagedItem } from "../phase3/model";
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

function money(value: number, currency: string) {
  const amount = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
  return currency === "KRW" ? `${amount}원` : `${currency} ${amount}`;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | HomeEventKind>("all");
  const [reviewPage, setReviewPage] = useState(0);
  const today = todayInTimeZone(timezone);
  const [calendarMonth, setCalendarMonth] = useState(() => today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState("");

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    setLoading(true);
    Promise.all([
      client.from("items").select("*").eq("user_id", session.user.id),
      client.from("profiles").select("timezone").eq("id", session.user.id).single(),
    ]).then(([itemResult, profileResult]) => {
      if (!active) return;
      if (itemResult.error || profileResult.error || !profileResult.data) {
        setError("홈 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        setLoading(false);
        return;
      }
      setItems((itemResult.data || []) as ManagedItem[]);
      setTimezone(profileResult.data.timezone || "Asia/Seoul");
      setCalendarMonth(todayInTimeZone(profileResult.data.timezone || "Asia/Seoul").slice(0, 7));
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
        <header className="home-hero">
          <div>
            <h1>놓치기 전에, 한눈에.</h1>
            <p>등록한 결제와 혜택 기한을 가까운 순서로 확인하세요.</p>
            <small>기준 · {displayDate(today, "day")} · {timezone}</small>
          </div>
          <div className="home-actions">
            <Link to="/items/new" className="button primary">＋ 직접 등록</Link>
            <Link to="/images" className="button secondary">이미지 관리</Link>
          </div>
        </header>

        {error ? <div className="notice error" role="alert">{error}</div> : null}
        {!error ? (
          <>
            <section className="home-summary-grid" aria-label="다음 30일 요약">
              <article className="home-summary-card primary-summary">
                <span>다음 30일 예정 결제</span>
                <strong>{money(summary.totals.KRW || 0, "KRW")}</strong>
                {Object.entries(summary.totals)
                  .filter(([currency]) => currency !== "KRW")
                  .map(([currency, value]) => (
                    <small key={currency}>{money(value, currency)}</small>
                  ))}
                {summary.excludedAmountCount ? (
                  <em>금액 미확인 {summary.excludedAmountCount}건 합계 제외</em>
                ) : null}
                <p>등록된 일정 기준 예상 금액 · 실제 결제 내역 아님</p>
              </article>
              <article className="home-summary-card">
                <span>결제 예정</span>
                <strong>{summary.paymentCount}건</strong>
                <p>{displayDate(today, "day")}부터 {displayDate(summary.end, "day")}까지</p>
              </article>
              <article className="home-summary-card">
                <span>만료 예정 혜택</span>
                <strong>{summary.benefitCount}건</strong>
                <p>미사용 혜택 중 정확한 만료일이 있는 항목</p>
              </article>
            </section>

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
                            <small className={`event-kind ${event.kind}`}>{event.kind === "payment" ? "결제 예정" : "기간 만료 예정"}</small>
                          </span>
                          <em className={dday <= 3 ? "urgent" : ""}>{dday === 0 ? "D-day" : `D-${dday}`}</em>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="home-empty">{filter === "payment" ? "다가오는 결제 일정이 없어요." : filter === "benefit" ? "다가오는 기간 만료 예정 일정이 없어요." : "다가오는 일정이 없어요."}</div>
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
                  <div className="calendar-legend"><span><i className="payment-dot" /> 결제</span><span><i className="benefit-dot" /> 기간 만료 예정</span></div>
                  <Link to="/calendar" className="calendar-full-link">전체 캘린더 보기 →</Link>
                  {selectedDate ? (
                    <div className="selected-date-panel">
                      <strong>{displayDate(selectedDate, "day")}</strong>
                      {dateEvents.length ? dateEvents.map((event) => (
                        <button type="button" key={event.key} onClick={() => navigate(`/items/${event.itemId}`)}>{event.name} · {event.kind === "payment" ? "결제" : "기간 만료 예정"}</button>
                      )) : <span>이 날짜에 등록된 일정이 없어요.</span>}
                    </div>
                  ) : null}
                </section>

                <section className="home-card review-card">
                  <div className="home-card-header">
                    <div><h2>정보를 확인해 주세요</h2><p>정확한 일정과 합계에 필요한 항목이에요.</p></div>
                    <span className="review-count">{reviewItems.length}건</span>
                  </div>
                  <div className="review-list">
                    {reviewItems.length ? visibleReviewItems.map((item) => (
                      <Link to={`/items/${item.id}/edit`} className="review-row" key={item.id}><span><b>{item.service_name}</b><small>{!item.target_date_value || item.target_date_precision !== "day" ? "정확한 날짜 확인 필요" : "금액·통화 확인 필요"}</small></span><strong>정보 입력</strong></Link>
                    )) : <div className="home-empty compact">확인이 필요한 항목이 없어요.</div>}
                  </div>
                  {reviewItems.length > 2 ? (
                    <div className="review-navigation" aria-label="확인 필요 항목 페이지 이동">
                      <button type="button" aria-label="이전 항목" disabled={reviewPage === 0} onClick={() => setReviewPage((page) => page - 1)}>‹</button>
                      <button type="button" aria-label="다음 항목" disabled={reviewPage >= reviewPageCount - 1} onClick={() => setReviewPage((page) => page + 1)}>›</button>
                    </div>
                  ) : null}
                </section>
              </aside>
            </section>

            <section className="home-news-section">
              <div className="home-card-header"><div><h2>내 구독의 최신 소식</h2><p>검증된 공식 소식만 연결할 예정이에요.</p></div></div>
              <div className="home-card home-empty news-empty"><strong>최신 소식 기능은 아직 연결되지 않았어요.</strong><span>Phase 8에서 공식 출처·검수 기준과 함께 구현합니다.</span></div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
