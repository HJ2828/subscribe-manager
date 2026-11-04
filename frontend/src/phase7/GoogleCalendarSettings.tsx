import { useEffect, useState } from "react";

import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  startGoogleCalendarConnect,
  syncGoogleCalendar,
  updateGoogleCalendarEventTypes,
  type GoogleCalendarStatus,
} from "../lib/api";
import { CALENDAR_KIND_GROUPS, type CalendarEventKind } from "../phase5/calendarModel";
import "./phase7.css";

const EVENT_TYPES = CALENDAR_KIND_GROUPS;

export function GoogleCalendarSettings({ accessToken }: { accessToken: string }) {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const next = await getGoogleCalendarStatus(accessToken);
      setStatus(next);
      setSelected(next.selected_event_types);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google Calendar 상태를 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    void load();
    const result = new URLSearchParams(window.location.search).get("google_calendar");
    if (result === "connected") setMessage("Google Calendar를 연결하고 내부 일정을 내보냈어요.");
    if (result === "denied") setError("Google Calendar 권한 동의가 완료되지 않았습니다.");
    if (result === "failed") setError("Google Calendar 연결을 완료하지 못했습니다. 설정을 확인하고 다시 시도해 주세요.");
    if (result) window.history.replaceState(null, "", "/settings");
  }, [accessToken]);

  async function runSync(
    action: () => Promise<{ created: number; updated: number; deleted: number; failed: number }>,
    success: string,
  ) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await action();
      if (result.failed) setError(`${result.failed}건을 Google Calendar에 반영하지 못했어요. 내부 일정은 그대로 유지됩니다.`);
      else setMessage(success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google Calendar 동기화를 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const { authorization_url } = await startGoogleCalendarConnect(accessToken);
      window.location.assign(authorization_url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google 연결을 시작하지 못했습니다.");
      setBusy(false);
    }
  }

  async function disconnect(deleteEvents: boolean) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await disconnectGoogleCalendar(accessToken, deleteEvents);
      if (result.failed) setError(`연결은 해제했지만 Google 일정 ${result.failed}건을 삭제하지 못했어요.`);
      else setMessage(deleteEvents ? "연결을 해제하고 내보낸 일정을 삭제했어요." : "연결을 해제하고 Google 일정은 유지했어요.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google Calendar 연결을 해제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
    setDisconnecting(false);
  }

  const connected = status?.status === "connected" || status?.status === "sync_delayed";
  const statusLabel = !status?.configured
    ? "외부 설정 필요"
    : status.status === "connected"
      ? "연결됨"
      : status.status === "sync_delayed"
        ? "동기화 지연"
        : status.status === "reauth_required"
          ? "재연결 필요"
          : "연결 안 됨";

  return (
    <section className="settings-card google-calendar-card">
      <div className="google-calendar-heading">
        <div><h2>Google Calendar</h2><p>내부 일정을 원본으로 전용 보조 캘린더에 단방향으로 내보내요.</p></div>
        <span className={`google-status status-${status?.status || "disconnected"}`}>{statusLabel}</span>
      </div>
      {message ? <p className="google-message success" role="status">{message}</p> : null}
      {error ? <p className="google-message error" role="alert">{error}</p> : null}
      {!status ? <p className="detail-muted">연결 상태를 확인하는 중…</p> : !status.configured ? (
        <p className="detail-muted">서버의 Google OAuth와 토큰 암호화 환경 변수를 설정한 뒤 사용할 수 있어요.</p>
      ) : connected ? (
        <>
          <div className="google-calendar-summary"><span>전용 캘린더</span><strong>{status.calendar_name}</strong><small>{status.last_sync_at ? `마지막 동기화 ${new Date(status.last_sync_at).toLocaleString("ko-KR")}` : "아직 동기화 기록이 없어요."}</small></div>
          <fieldset className="google-event-types"><legend>내보낼 일정 종류</legend><p className="google-event-types-help">비슷한 일정은 한 그룹으로 선택할 수 있어요.</p>{EVENT_TYPES.map((group) => { const selectedKinds = group.kinds.filter((kind) => selected.includes(kind)); const checked = selectedKinds.length === group.kinds.length; const partial = selectedKinds.length > 0 && !checked; return <label key={group.key} className={partial ? "partial" : ""}><input type="checkbox" checked={checked} aria-checked={partial ? "mixed" : checked} onChange={(event) => setSelected((current) => { const next = new Set(current); group.kinds.forEach((kind: CalendarEventKind) => event.target.checked ? next.add(kind) : next.delete(kind)); return [...next]; })} />{group.label}</label>; })}</fieldset>
          <div className="google-actions"><button type="button" className="button secondary" disabled={busy || !selected.length} onClick={() => runSync(() => updateGoogleCalendarEventTypes(accessToken, selected), "내보낼 일정 종류를 저장하고 동기화했어요.")}>종류 저장</button><button type="button" className="button secondary" disabled={busy} onClick={() => runSync(() => syncGoogleCalendar(accessToken), "Google Calendar 동기화를 완료했어요.")}>지금 동기화</button><button type="button" className="text-danger" disabled={busy} onClick={() => setDisconnecting(true)}>연결 해제</button></div>
          {disconnecting ? <div className="google-disconnect" role="dialog" aria-label="Google Calendar 연결 해제"><strong>내보낸 Google 일정을 어떻게 할까요?</strong><p>어느 쪽을 선택해도 연결 토큰과 자동 동기화는 중단됩니다.</p><div><button type="button" className="button danger" disabled={busy} onClick={() => disconnect(true)}>일정 삭제 후 해제</button><button type="button" className="button secondary" disabled={busy} onClick={() => disconnect(false)}>일정 유지하고 해제</button><button type="button" className="button ghost" onClick={() => setDisconnecting(false)}>취소</button></div></div> : null}
          <p className="google-calendar-note">Google에서 직접 수정한 내용은 앱으로 가져오지 않으며 다음 동기화에서 내부 값으로 다시 반영될 수 있어요. Google 자체 알림은 앱 알림과 중복될 수 있습니다.</p>
        </>
      ) : (
        <><button type="button" className="button primary full" disabled={busy} onClick={connect}>{status.status === "reauth_required" ? "Google Calendar 다시 연결" : "Google Calendar 연결"}</button><p className="google-calendar-note">앱이 만든 `subscribe-manager` 캘린더와 그 일정만 관리하는 권한을 요청합니다.</p></>
      )}
    </section>
  );
}
