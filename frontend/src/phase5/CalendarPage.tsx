import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { addDays, todayInTimeZone } from "../home/homeModel";
import { getGoogleCalendarStatus, type GoogleCalendarStatus } from "../lib/api";
import { typeLabel, type ManagedItem } from "../phase3/model";
import { PageHeader } from "../components/ui";
import {
  CALENDAR_KIND_LABELS,
  CALENDAR_KIND_GROUPS,
  buildCalendarEvents,
  filterCalendarEvents,
  monthGrid,
  weekDates,
  type CalendarEvent,
  type CalendarEventKind,
} from "./calendarModel";
import "./phase5.css";

type View = "month" | "week" | "list";
const KINDS = Object.keys(CALENDAR_KIND_LABELS) as CalendarEventKind[];

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7);
}

function money(event: CalendarEvent) {
  if (event.amount === null || !event.currency) return "";
  const value = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(event.amount);
  return event.currency === "KRW" ? `${value}원` : `${event.currency} ${value}`;
}

function EventButton({ event }: { event: CalendarEvent }) {
  return (
    <button className={`calendar-event kind-${event.kind}`} type="button" onClick={() => navigate(`/items/${event.itemId}`)}>
      <i aria-hidden="true" />
      <span><b>{event.name}</b><small>{CALENDAR_KIND_LABELS[event.kind]} · {typeLabel(event.managementType, true)}</small></span>
      {money(event) ? <strong>{money(event)}</strong> : null}
    </button>
  );
}

export function CalendarPage({ navigation }: { navigation: ReactNode }) {
  const { client, session } = useAuth();
  const [items, setItems] = useState<ManagedItem[]>([]);
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => todayInTimeZone("Asia/Seoul"));
  const [selectedDate, setSelectedDate] = useState("");
  const [kinds, setKinds] = useState<Set<CalendarEventKind>>(() => new Set(KINDS));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus | null>(null);

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    Promise.all([
      client.from("items").select("*").eq("user_id", session.user.id),
      client.from("profiles").select("timezone").eq("id", session.user.id).single(),
    ]).then(([itemResult, profileResult]) => {
      if (!active) return;
      if (itemResult.error || profileResult.error || !profileResult.data) {
        setError("캘린더 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      } else {
        const zone = profileResult.data.timezone || "Asia/Seoul";
        setItems((itemResult.data || []) as ManagedItem[]);
        setTimezone(zone);
        setAnchor(todayInTimeZone(zone));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [client, session]);

  useEffect(() => {
    if (!session?.access_token) return;
    getGoogleCalendarStatus(session.access_token).then(setGoogleStatus).catch(() => setGoogleStatus(null));
  }, [session?.access_token]);

  const month = anchor.slice(0, 7);
  const gridDates = monthGrid(month);
  const week = weekDates(anchor);
  const range = view === "month"
    ? { from: gridDates[0], to: gridDates[41] }
    : view === "week"
      ? { from: week[0], to: week[6] }
      : { from: anchor, to: addDays(anchor, 365) };
  const events = useMemo(() => filterCalendarEvents(buildCalendarEvents(items, range.from, range.to), kinds), [items, range.from, range.to, kinds]);
  const dates = view === "month" ? gridDates : week;
  const title = view === "week"
    ? `${week[0].replaceAll("-", ".")} – ${week[6].replaceAll("-", ".")}`
    : view === "list" ? `${anchor.replaceAll("-", ".")}부터` : `${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월`;

  function move(amount: number) {
    if (view === "month") setAnchor(`${shiftMonth(month, amount)}-01`);
    else setAnchor(addDays(anchor, amount * (view === "week" ? 7 : 30)));
    setSelectedDate("");
  }

  function toggleGroup(group: (typeof CALENDAR_KIND_GROUPS)[number]) {
    setKinds((current) => {
      const next = new Set(current);
      const enabled = group.kinds.every((kind) => next.has(kind));
      group.kinds.forEach((kind) => enabled ? next.delete(kind) : next.add(kind));
      return next;
    });
  }

  return (
    <div className="app-shell">
      {navigation}
      <main className="calendar-page">
        <PageHeader eyebrow="캘린더" title="캘린더" description="결제와 만료 일정을 날짜별로 확인하세요." actions={<div className="calendar-heading-actions"><button className="google-calendar-link" type="button" onClick={() => navigate("/settings")}>Google Calendar · {googleStatus?.status === "connected" ? "연결됨" : googleStatus?.status === "sync_delayed" ? "동기화 지연" : googleStatus?.status === "reauth_required" ? "재연결 필요" : "연결 설정"}</button><button className="button secondary" type="button" onClick={() => { const today = todayInTimeZone(timezone); setAnchor(today); setSelectedDate(today); }}>오늘</button></div>} />

        <section className="calendar-toolbar" aria-label="캘린더 보기와 필터">
          <div className="view-tabs">{(["month", "week", "list"] as View[]).map((value) => <button type="button" key={value} className={view === value ? "active" : ""} onClick={() => setView(value)}>{value === "month" ? "월간" : value === "week" ? "주간" : "목록"}</button>)}</div>
          <div className="kind-filters" aria-label="일정 그룹 필터">{CALENDAR_KIND_GROUPS.map((group) => { const active = group.kinds.every((kind) => kinds.has(kind)); const partial = !active && group.kinds.some((kind) => kinds.has(kind)); return <button type="button" key={group.key} className={active ? "active" : partial ? "partial" : ""} aria-pressed={active} onClick={() => toggleGroup(group)}>{group.label}</button>; })}</div>
        </section>

        <section className="full-calendar-card">
          <div className="calendar-period-heading"><button type="button" aria-label="이전 기한" onClick={() => move(-1)}>‹</button><h2>{title}</h2><button type="button" aria-label="다음 기한" onClick={() => move(1)}>›</button></div>
          {loading ? <div className="phase5-state">캘린더를 불러오는 중…</div> : error ? <div className="phase5-state error">{error}</div> : view === "list" ? (
            <div className="calendar-list">{events.length ? events.map((event) => <div className="calendar-list-row" key={event.key}><time>{event.date.replaceAll("-", ".")}</time><EventButton event={event} /></div>) : <div className="phase5-state">선택한 조건의 앞으로 일정이 없어요.</div>}</div>
          ) : (
            <>
              <div className="full-calendar-weekdays">{["월", "화", "수", "목", "금", "토", "일"].map((day) => <span key={day}>{day}</span>)}</div>
              <div className={`full-calendar-grid ${view}`}>
                {dates.map((date) => {
                  const dayEvents = events.filter((event) => event.date === date);
                  return <button type="button" className={`${date === todayInTimeZone(timezone) ? "today " : ""}${date === selectedDate ? "selected " : ""}${view === "month" && date.slice(0, 7) !== month ? "outside" : ""}`} key={date} onClick={() => setSelectedDate(date)}><time>{Number(date.slice(8))}</time><span>{dayEvents.slice(0, view === "month" ? 3 : 8).map((event) => <i className={`kind-${event.kind}`} key={event.key}>{event.name}</i>)}{dayEvents.length > (view === "month" ? 3 : 8) ? <small>+{dayEvents.length - (view === "month" ? 3 : 8)}</small> : null}</span></button>;
                })}
              </div>
              {selectedDate ? <div className="selected-date-panel"><h3>{selectedDate.replaceAll("-", ".")} 일정</h3>{events.filter((event) => event.date === selectedDate).length ? events.filter((event) => event.date === selectedDate).map((event) => <EventButton event={event} key={event.key} />) : <p>이 날짜에 선택한 종류의 일정이 없어요.</p>}</div> : null}
            </>
          )}
        </section>
        <p className="calendar-note">연·월만 확인된 날짜와 날짜 미입력 항목은 임의의 일자를 만들지 않아 캘린더에서 제외됩니다.</p>
      </main>
    </div>
  );
}
