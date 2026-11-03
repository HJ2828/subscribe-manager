import { publicConfig } from "./config";

export type HealthResponse = {
  status: "ok";
  environment: string;
};

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${publicConfig.apiBaseUrl}/health`, { signal });

  if (!response.ok) {
    throw new Error("API 상태를 확인하지 못했습니다.");
  }

  return (await response.json()) as HealthResponse;
}

export async function deleteAccount(accessToken: string): Promise<{ status: "completed" }> {
  const response = await fetch(`${publicConfig.apiBaseUrl}/api/v1/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    status?: "completed";
    error?: { message?: string };
  };
  if (!response.ok || body.status !== "completed") {
    throw new Error(body.error?.message || "회원 탈퇴를 완료하지 못했습니다.");
  }
  return { status: body.status };
}

async function imageRequest<T>(accessToken: string, assetId: string, action = "analyze", body?: unknown): Promise<T> {
  const response = await fetch(`${publicConfig.apiBaseUrl}/api/v1/images/${assetId}/${action}`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "이미지 처리에 실패했어요.");
  return payload as T;
}

export function analyzeImage(token: string, id: string) { return imageRequest<{ asset: any; extraction: any; limit: any }>(token, id); }
export function changeImageLifecycle(token: string, id: string, action: "trash" | "restore" | "delete" | "retry") { return imageRequest<{ asset: any }>(token, id, action); }
export function confirmImage(token: string, id: string, itemId: string | null, originalKeep: boolean) { return imageRequest<{ asset: any }>(token, id, "confirm", { item_id: itemId, original_keep: originalKeep }); }
export async function getImageSignedUrl(token: string, id: string): Promise<{ signed_url: string }> {
  const response = await fetch(`${publicConfig.apiBaseUrl}/api/v1/images/${id}/signed-url`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "이미지를 불러오지 못했어요.");
  return payload as { signed_url: string };
}

async function notificationRequest<T>(token: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${publicConfig.apiBaseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "알림 설정을 처리하지 못했어요.");
  return payload as T;
}

export function getPushConfig(token: string) {
  return notificationRequest<{ configured: boolean; public_key: string | null }>(token, "/api/v1/push/config");
}

export function registerPushSubscription(token: string, subscription: PushSubscriptionJSON) {
  return notificationRequest<{ status: "registered" }>(token, "/api/v1/push/subscriptions", subscription);
}

export function unregisterPushSubscription(token: string, endpoint: string) {
  return notificationRequest<{ status: "unregistered"; push_enabled: boolean }>(token, "/api/v1/push/unsubscribe", { endpoint });
}

export type GoogleCalendarStatus = {
  configured: boolean;
  status: "connected" | "reauth_required" | "sync_delayed" | "disconnected";
  calendar_name: string;
  selected_event_types: string[];
  last_sync_at: string | null;
  last_error: string | null;
};

async function googleCalendarRequest<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${publicConfig.apiBaseUrl}/api/v1/google-calendar${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "Google Calendar 요청을 처리하지 못했습니다.");
  return payload as T;
}

export function getGoogleCalendarStatus(token: string) {
  return googleCalendarRequest<GoogleCalendarStatus>(token, "/status");
}

export function startGoogleCalendarConnect(token: string) {
  return googleCalendarRequest<{ authorization_url: string }>(token, "/connect", "POST");
}

export function syncGoogleCalendar(token: string) {
  return googleCalendarRequest<{ created: number; updated: number; deleted: number; failed: number }>(token, "/sync", "POST");
}

export function updateGoogleCalendarEventTypes(token: string, eventTypes: string[]) {
  return googleCalendarRequest<{ created: number; updated: number; deleted: number; failed: number }>(token, "/event-types", "PATCH", { event_types: eventTypes });
}

export function disconnectGoogleCalendar(token: string, deleteEvents: boolean) {
  return googleCalendarRequest<{ status: "disconnected"; deleted: number; failed: number }>(token, "/disconnect", "POST", { delete_events: deleteEvents });
}
