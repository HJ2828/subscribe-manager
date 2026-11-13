import { useEffect, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/ui";
import { getPushConfig, registerPushSubscription, unregisterPushSubscription } from "../lib/api";
import "./phase5.css";

type NotificationRecord = {
  id: string;
  title: string;
  body: string;
  target_path: string | null;
  read_at: string | null;
  created_at: string;
};

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export function NotificationsPage({ navigation }: { navigation: ReactNode }) {
  const { client, session } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported] = useState(() => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);

  useEffect(() => {
    if (!client || !session) return;
    client.from("in_app_notifications").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (error) setNotice("알림 기록을 불러오지 못했어요. Phase 5 마이그레이션 적용을 확인해 주세요.");
        else setNotifications((data || []) as NotificationRecord[]);
        setLoading(false);
      });
    if (pushSupported) navigator.serviceWorker.getRegistration().then((registration) => registration?.pushManager.getSubscription()).then((subscription) => setPushEnabled(Boolean(subscription)));
  }, [client, session, pushSupported]);

  async function enablePush() {
    if (!session || !client || !pushSupported) return;
    setNotice("");
    try {
      const config = await getPushConfig(session.access_token);
      if (!config.configured || !config.public_key) throw new Error("Web Push 서버 키가 아직 설정되지 않았어요. 앱 안 알림은 계속 사용할 수 있어요.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("브라우저 알림 권한이 허용되지 않았어요.");
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.public_key) });
      await registerPushSubscription(session.access_token, subscription.toJSON());
      setPushEnabled(true);
      setNotice("이 기기의 Web Push를 켰어요.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Web Push를 켜지 못했어요.");
    }
  }

  async function disablePush() {
    if (!session || !client || !pushSupported) return;
    setNotice("");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await unregisterPushSubscription(session.access_token, subscription.endpoint);
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      setNotice("이 기기의 Web Push를 껐어요. 앱 안 알림 기록은 유지돼요.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Web Push를 끄지 못했어요.");
    }
  }

  async function markRead(id: string) {
    if (!client) return;
    const readAt = new Date().toISOString();
    const { error } = await client.from("in_app_notifications").update({ read_at: readAt }).eq("id", id);
    if (!error) setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: readAt } : item));
  }

  async function markAllRead() {
    if (!client || !session) return;
    const readAt = new Date().toISOString();
    const { error } = await client.from("in_app_notifications").update({ read_at: readAt }).eq("user_id", session.user.id).is("read_at", null);
    if (!error) setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || readAt })));
  }

  return <div className="app-shell">{navigation}<main className="notifications-page">
    <PageHeader eyebrow="알림" title="알림" description="앱 안 알림과 이 기기의 Push 상태를 확인하세요." actions={<button className="button secondary" type="button" onClick={markAllRead} disabled={!notifications.some((item) => !item.read_at)}>모두 읽음</button>} />
    <section className="push-card"><div><h2>Web Push</h2><p>{!pushSupported ? "이 브라우저에서는 Web Push를 지원하지 않아요. 앱 안 알림은 유지됩니다." : pushEnabled ? "이 기기에서 Push를 받을 수 있어요." : "권한을 허용하면 브라우저를 닫아도 지원 환경에서 Push를 받을 수 있어요."}</p></div>{pushSupported ? <button className={`button ${pushEnabled ? "secondary" : "primary"}`} type="button" onClick={pushEnabled ? disablePush : enablePush}>{pushEnabled ? "이 기기에서 끄기" : "이 기기에서 켜기"}</button> : null}</section>
    {notice ? <div className="notice info">{notice}</div> : null}
    <div className="notification-actions" aria-hidden="true" />
    {loading ? <div className="phase5-state">알림을 불러오는 중…</div> : notifications.length ? <section className="notification-list">{notifications.map((item) => <article className={`notification-card${item.read_at ? "" : " unread"}`} key={item.id}><i aria-hidden="true"/><div onClick={() => item.target_path && navigate(item.target_path)} role={item.target_path ? "button" : undefined} tabIndex={item.target_path ? 0 : undefined}><strong>{item.title}</strong><p>{item.body}</p><small>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}</small></div>{!item.read_at ? <button type="button" onClick={() => markRead(item.id)}>읽음</button> : null}</article>)}</section> : <div className="phase5-state">아직 도착한 알림이 없어요.</div>}
  </main></div>;
}
