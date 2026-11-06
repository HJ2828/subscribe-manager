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

export type BrandSearchCandidate = { domain: string; name?: string; logo_url?: string | null };

export async function searchBrands(token: string, query: string, signal?: AbortSignal) {
  const response = await fetch(`${publicConfig.apiBaseUrl}/api/v1/brands/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "브랜드를 검색하지 못했어요.");
  return payload as { candidates: BrandSearchCandidate[] };
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

export type SupportStatus = "management_only" | "collecting" | "needs_information" | "verifying" | "supported" | "unsupported";
export type ServiceNews = {
  id: string; catalog_id: string; service_name?: string; news_type: string; title: string; summary: string;
  source_title: string; source_url: string; source_domain: string; source_country_code: string | null; source_language: string | null; announced_on: string | null; applies_on: string | null;
  country_codes: string[]; plan_scopes: string[]; conditions: string | null; impact_summary: string | null;
  applicability_status: "confirmed" | "needs_confirmation"; checked_at: string; status: string; matching_item_ids?: string[];
  last_verified_at?: string | null; collected_at?: string; relevance_summary?: string; is_scrapped?: boolean;
  is_available?: boolean; scrapped_at?: string;
  is_archived?: boolean; is_ott_schedule?: boolean;
};
export type CancellationGuide = {
  id: string; catalog_id: string; payment_path: string; country_code: string; plan_scope: string | null; title: string;
  steps: string[]; conditions: string | null; access_after_cancel: string | null; source_title: string; source_url: string;
  source_domain: string; checked_at: string; status: "published" | "recheck_required" | string;
};
export type ItemContent = {
  catalog: ({ id: string; display_name: string } & Record<string, unknown>) | null;
  guides: CancellationGuide[]; news: ServiceNews[];
  support: { cancellation: SupportStatus; news: SupportStatus };
  payment_path_needed?: boolean;
};

async function contentRequest<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${publicConfig.apiBaseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "정보 지원 요청을 처리하지 못했어요.");
  return payload as T;
}

export const getRelevantNews = (token: string) => contentRequest<ServiceNews[]>(token, "/api/v1/content/news");
export const getNewsScraps = (token: string) => contentRequest<ServiceNews[]>(token, "/api/v1/content/scraps");
export const getOttNews = (token: string) => contentRequest<ServiceNews[]>(token, "/api/v1/content/ott-news");
export const addNewsScrap = (token: string, newsId: string) => contentRequest<{ news_id: string; is_scrapped: boolean }>(token, `/api/v1/content/news/${newsId}/scrap`, "POST");
export const removeNewsScrap = (token: string, newsId: string) => contentRequest<{ news_id: string; is_scrapped: boolean }>(token, `/api/v1/content/news/${newsId}/scrap`, "DELETE");
export type CollectionStatus = { configured: boolean; status: "ready" | "no_subscriptions" | "awaiting_first_run" | "new_content" | "no_new_content" | "search_failed" | "source_failed" | "precheck_failed" | "unchanged" | "conditions_unconfirmed" | "budget_limited"; service_count: number; last_checked_at: string | null };
export const getCollectionStatus = (token: string) => contentRequest<CollectionStatus>(token, "/api/v1/content/collection-status");
export type OperatorAnnouncement = { id: string; title: string; body: string; status?: string; published_at: string | null; created_at: string };
export const getAnnouncements = (token: string) => contentRequest<OperatorAnnouncement[]>(token, "/api/v1/content/announcements");
export const getItemContent = (token: string, itemId: string) => contentRequest<ItemContent>(token, `/api/v1/content/items/${itemId}`);
export const getOperatorStatus = (token: string) => contentRequest<{ is_operator: boolean }>(token, "/api/v1/content/operator-status");
export const getReviewData = (token: string) => contentRequest<any>(token, "/api/v1/operations/content");
export const createCatalog = (token: string, body: unknown) => contentRequest<any>(token, "/api/v1/operations/catalogs", "POST", body);
export const setCatalogCollection = (token: string, id: string, enabled: boolean) => contentRequest<any>(token, `/api/v1/operations/catalogs/${id}/collection`, "PATCH", { enabled });
export const deleteCatalog = (token: string, id: string) => contentRequest<{ id: string; deleted: boolean }>(token, `/api/v1/operations/catalogs/${id}`, "DELETE");
export const updateCollectionSettings = (token: string, body: { enabled: boolean; interval_hours: number }) => contentRequest<any>(token, "/api/v1/operations/collection-settings", "PATCH", body);
export const createCancellationGuide = (token: string, body: unknown) => contentRequest<any>(token, "/api/v1/operations/cancellation-guides", "POST", body);
export const createServiceNews = (token: string, body: unknown) => contentRequest<any>(token, "/api/v1/operations/news", "POST", body);
export const recordCollectionRun = (token: string, body: unknown) => contentRequest<any>(token, "/api/v1/operations/collection-runs", "POST", body);
export const createAnnouncement = (token: string, body: { title: string; body: string }) => contentRequest<any>(token, "/api/v1/operations/announcements", "POST", body);
export const reviewAnnouncement = (token: string, id: string, status: "published" | "hidden", _reason?: string) => contentRequest<any>(token, `/api/v1/operations/announcements/${id}`, "PATCH", { status });
export const deleteAnnouncement = (token: string, id: string) => contentRequest<{ id: string; deleted: boolean }>(token, `/api/v1/operations/announcements/${id}`, "DELETE");
export const reviewContent = (token: string, entity: "cancellation_guide" | "news", id: string, status: string, reason: string) =>
  contentRequest<any>(token, `/api/v1/operations/${entity}/${id}/review`, "PATCH", { status, reason });
