import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { addDays, todayInTimeZone } from "../home/homeModel";
import { getGoogleCalendarStatus, type GoogleCalendarStatus } from "../lib/api";
import { syncRecurringItemDates } from "../lib/recurringItems";
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

// End of calendar page.
function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7);
}

function money(event: CalendarEvent) {
  if (event.amount === null) return "";
  const value = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(event.amount);
  if (event.currency === "KRW") return `${value}원`;
  if (event.currency) return `${event.currency} ${value}`;
  return event.managementType === "points" ? `${value} P` : "";
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
  const selectedDatePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    Promise.all([
      client.from("items").select("*").eq("user_id", session.user.id),
      client.from("profiles").select("timezone").eq("id", session.user.id).single(),
    ]).then(async ([itemResult, profileResult]) => {
      if (!active) return;
      if (itemResult.error || profileResult.error || !profileResult.data) {
        setError("캘린더 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      } else {
        const zone = profileResult.data.timezone || "Asia/Seoul";
        const synced = await syncRecurringItemDates(client, session.user.id, (itemResult.data || []) as ManagedItem[], zone);
        if (!active) return;
        setItems(synced.items);
        if (synced.failedCount) setError("일부 반복 결제의 다음 결제일을 갱신하지 못했어요. 잠시 후 다시 시도해 주세요.");
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

  useEffect(() => {
    if (!selectedDate) return;
    requestAnimationFrame(() => selectedDatePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [selectedDate]);

  const month = anchor.slice(0, 7);
  const gridDates = monthGrid(month);
  const week = weekDates(anchor);
  const range = view === "month"
    ? { from: gridDates[0], to: gridDates[41] }
    : view === "week"
      ? { from: week[0], to: week[6] }
      : { from: `${month}-01`, to: addDays(`${shiftMonth(month, 1)}-01`, -1) };
  const events = useMemo(() => filterCalendarEvents(buildCalendarEvents(items, range.from, range.to), kinds), [items, range.from, range.to, kinds]);
  const dates = view === "month" ? gridDates : week;
  const selectedYear = Number(month.slice(0, 4));
  const selectedMonth = Number(month.slice(5));
  const years = Array.from({ length: 21 }, (_, index) => selectedYear - 10 + index);

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

  function selectDate(date: string) {
    setSelectedDate(date);
  }

  return (
    <div className="app-shell">
      {navigation}
      <main className="calendar-page">
        <PageHeader eyebrow="캘린더" title="캘린더" description="결제와 만료 일정을 날짜별로 확인하세요." actions={<button className="google-calendar-link" type="button" onClick={() => navigate("/settings")}>Google Calendar · {googleStatus?.status === "connected" ? "연결됨" : googleStatus?.status === "sync_delayed" ? "동기화 지연" : googleStatus?.status === "reauth_required" ? "재연결 필요" : "연결 설정"}</button>} />

        <section className="calendar-toolbar" aria-label="캘린더 보기와 필터">
          <label className="view-select"><select aria-label="캘린더 보기" value={view} onChange={(event) => setView(event.target.value as View)}><option value="month">월간</option><option value="week">주간</option><option value="list">목록</option></select></label>
          <div className="kind-filters" aria-label="일정 그룹 필터">{CALENDAR_KIND_GROUPS.map((group) => { const active = group.kinds.every((kind) => kinds.has(kind)); const partial = !active && group.kinds.some((kind) => kinds.has(kind)); return <button type="button" key={group.key} className={active ? "active" : partial ? "partial" : ""} aria-pressed={active} onClick={() => toggleGroup(group)}>{group.label}</button>; })}</div>
        </section>

        <section className="full-calendar-card">
          <div className="calendar-period-heading">
            <button type="button" aria-label="이전 기한" onClick={() => move(-1)}>‹</button>
            <div className="calendar-date-picker"><select aria-label="년도 선택" value={selectedYear} onChange={(event) => setAnchor(`${event.target.value}-${String(selectedMonth).padStart(2, "0")}-01`)}>{years.map((yearOption) => <option key={yearOption} value={yearOption}>{yearOption}년</option>)}</select><select aria-label="월 선택" value={selectedMonth} onChange={(event) => setAnchor(`${selectedYear}-${String(event.target.value).padStart(2, "0")}-01`)}>{Array.from({ length: 12 }, (_, index) => index + 1).map((monthOption) => <option key={monthOption} value={monthOption}>{monthOption}월</option>)}</select><button className="calendar-today-button" type="button" onClick={() => { const today = todayInTimeZone(timezone); setAnchor(today); setSelectedDate(""); }}>오늘</button></div>
            <button type="button" aria-label="다음 기한" onClick={() => move(1)}>›</button>
          </div>
          {loading ? <div className="phase5-state">캘린더를 불러오는 중…</div> : error ? <div className="phase5-state error">{error}</div> : view === "list" ? (
            <div className="calendar-list">{events.length ? events.map((event) => <div className="calendar-list-row" key={event.key}><time>{event.date.replaceAll("-", ".")}</time><EventButton event={event} /></div>) : <div className="phase5-state">선택한 조건의 앞으로 일정이 없어요.</div>}</div>
          ) : (
            <>
              <div className="full-calendar-weekdays">{["월", "화", "수", "목", "금", "토", "일"].map((day, index) => <span className={index === 6 ? "sunday" : ""} key={day}>{day}</span>)}</div>
              <div className={`full-calendar-grid ${view}`}>
                {dates.map((date, index) => {
                  const dayEvents = events.filter((event) => event.date === date);
                  const visibleCount = view === "month" ? 2 : 8;
                  return <button type="button" className={`${date === todayInTimeZone(timezone) ? "today " : ""}${date === selectedDate ? "selected " : ""}${index % 7 === 6 ? "sunday " : ""}${view === "month" && date.slice(0, 7) !== month ? "outside" : ""}`} key={date} onClick={() => selectDate(date)}><time>{Number(date.slice(8))}</time><span>{dayEvents.slice(0, visibleCount).map((event) => <i className={`kind-${event.kind}`} key={event.key}>{event.name}</i>)}{dayEvents.length > visibleCount ? <small>+{dayEvents.length - visibleCount}</small> : null}</span></button>;
                })}
              </div>
              {selectedDate ? <div className="selected-date-panel" ref={selectedDatePanelRef}><h3>{selectedDate.replaceAll("-", ".")} 일정</h3>{events.filter((event) => event.date === selectedDate).length ? events.filter((event) => event.date === selectedDate).map((event) => <EventButton event={event} key={event.key} />) : <p>이 날짜에 등록된 일정이 없어요.</p>}</div> : null}
            </>
          )}
        </section>
        <p className="calendar-note">연·월만 확인된 날짜와 날짜 미입력 항목은 임의의 일자를 만들지 않아 캘린더에서 제외됩니다.</p>
      </main>
    </div>
  );
}
