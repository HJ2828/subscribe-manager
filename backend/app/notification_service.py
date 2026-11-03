import asyncio
import json
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from app.config import Settings, get_settings
from app.errors import ApiError
from app.security import CurrentUser


def parse_time(value: str) -> time:
    return time.fromisoformat(value[:8])


def quiet_time_delay(now: datetime, timezone: str, start: str, end: str) -> datetime | None:
    try:
        zone = ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("Asia/Seoul")
    local = now.astimezone(zone)
    start_time, end_time = parse_time(start), parse_time(end)
    current = local.timetz().replace(tzinfo=None)
    in_quiet = (
        current >= start_time or current < end_time
        if start_time > end_time
        else start_time <= current < end_time
    )
    if not in_quiet:
        return None
    target_date = local.date() + timedelta(
        days=1 if current >= start_time and start_time > end_time else 0
    )
    delayed = datetime.combine(target_date, end_time, tzinfo=zone)
    return delayed.astimezone(UTC)


def notification_body(title: str, event_type: str, days_before: int) -> str:
    event_label = {
        "payment": "결제",
        "renewal": "갱신",
        "cancellation": "해지 마감",
        "review": "검토",
        "expiry": "만료",
        "warranty": "보장 종료",
    }.get(event_type, "일정")
    if days_before > 0:
        return f"{title} {event_label} {days_before}일 전입니다."
    day_label = {
        "payment": "결제일",
        "renewal": "갱신일",
        "cancellation": "해지 마감일",
        "review": "검토일",
        "expiry": "만료일",
        "warranty": "보장 종료일",
    }.get(event_type, "일정일")
    return f"{title} {day_label}입니다."


@dataclass(slots=True)
class ProcessResult:
    processed: int = 0
    sent: int = 0
    failed: int = 0
    unknown: int = 0
    skipped: int = 0
    delayed: int = 0


class NotificationService:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def configured(self) -> bool:
        return bool(self.settings.normalized_supabase_url and self.settings.supabase_secret_key)

    def headers(self, token: str | None = None) -> dict[str, str]:
        key = self.settings.supabase_secret_key
        if not key:
            raise ApiError(
                503, "notification_not_configured", "알림 저장소 연결이 설정되지 않았습니다."
            )
        return {
            "apikey": key,
            "Authorization": f"Bearer {token or key}",
            "Content-Type": "application/json",
        }

    async def register(
        self, user: CurrentUser, subscription: dict[str, Any], user_agent: str | None
    ) -> None:
        endpoint = str(subscription.get("endpoint") or "")
        keys = subscription.get("keys") or {}
        if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
            raise ApiError(422, "invalid_push_subscription", "Push 기기 정보를 확인해 주세요.")
        payload = {
            "user_id": str(user.id),
            "endpoint": endpoint,
            "p256dh": keys["p256dh"],
            "auth": keys["auth"],
            "user_agent": user_agent,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.settings.normalized_supabase_url}/rest/v1/push_subscriptions?on_conflict=user_id,endpoint",
                headers={**self.headers(), "Prefer": "resolution=merge-duplicates"},
                json=payload,
            )
        if response.status_code not in (200, 201):
            raise ApiError(502, "push_subscription_failed", "Push 기기를 등록하지 못했습니다.")
        async with httpx.AsyncClient(timeout=10) as client:
            await client.patch(
                f"{self.settings.normalized_supabase_url}/rest/v1/profiles",
                headers=self.headers(),
                params={"id": f"eq.{user.id}"},
                json={"push_notifications_enabled": True},
            )

    async def unregister(self, user: CurrentUser, endpoint: str) -> bool:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.delete(
                f"{self.settings.normalized_supabase_url}/rest/v1/push_subscriptions",
                headers=self.headers(),
                params={"user_id": f"eq.{user.id}", "endpoint": f"eq.{endpoint}"},
            )
        if response.status_code not in (200, 204):
            raise ApiError(502, "push_unsubscribe_failed", "Push 기기 연결을 해제하지 못했습니다.")
        async with httpx.AsyncClient(timeout=10) as client:
            remaining_response = await client.get(
                f"{self.settings.normalized_supabase_url}/rest/v1/push_subscriptions",
                headers=self.headers(),
                params={"user_id": f"eq.{user.id}", "select": "id", "limit": "1"},
            )
            remaining = (
                bool(remaining_response.json()) if remaining_response.status_code == 200 else True
            )
            await client.patch(
                f"{self.settings.normalized_supabase_url}/rest/v1/profiles",
                headers=self.headers(),
                params={"id": f"eq.{user.id}"},
                json={"push_notifications_enabled": remaining},
            )
        return remaining

    async def _patch_job(
        self, client: httpx.AsyncClient, job_id: str, payload: dict[str, Any]
    ) -> None:
        await client.patch(
            f"{self.settings.normalized_supabase_url}/rest/v1/notification_jobs",
            headers=self.headers(),
            params={"id": f"eq.{job_id}"},
            json=payload,
        )

    async def _claim_job(self, client: httpx.AsyncClient, job: dict[str, Any]) -> bool:
        response = await client.patch(
            f"{self.settings.normalized_supabase_url}/rest/v1/notification_jobs",
            headers={**self.headers(), "Prefer": "return=representation"},
            params={
                "id": f"eq.{job['id']}",
                "status": "in.(pending,retry,unknown)",
            },
            json={"status": "processing", "attempts": int(job["attempts"]) + 1},
        )
        return response.status_code == 200 and bool(response.json())

    async def _send_push(self, subscription: dict[str, Any], data: str) -> None:
        from pywebpush import webpush

        await asyncio.to_thread(
            webpush,
            subscription_info={
                "endpoint": subscription["endpoint"],
                "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
            },
            data=data,
            vapid_private_key=self.settings.vapid_private_key,
            vapid_claims={"sub": self.settings.vapid_subject},
            ttl=86400,
        )

    async def process_due(self, limit: int = 100, now: datetime | None = None) -> ProcessResult:
        if not self.configured:
            raise ApiError(
                503, "notification_not_configured", "알림 작업 연결이 설정되지 않았습니다."
            )
        current = (now or datetime.now(UTC)).astimezone(UTC)
        result = ProcessResult()
        async with httpx.AsyncClient(timeout=15) as client:
            await client.patch(
                f"{self.settings.normalized_supabase_url}/rest/v1/notification_jobs",
                headers=self.headers(),
                params={
                    "status": "eq.processing",
                    "updated_at": f"lt.{(current - timedelta(minutes=10)).isoformat()}",
                },
                json={
                    "status": "unknown",
                    "next_attempt_at": current.isoformat(),
                    "last_error": "worker_interrupted",
                },
            )
            refresh = await client.post(
                f"{self.settings.normalized_supabase_url}/rest/v1/rpc/refresh_phase5_schedules",
                headers=self.headers(),
                json={},
            )
            if refresh.status_code not in (200, 204):
                raise ApiError(
                    502,
                    "schedule_refresh_failed",
                    "미래 일정과 알림 작업을 갱신하지 못했습니다.",
                )
            response = await client.get(
                f"{self.settings.normalized_supabase_url}/rest/v1/notification_jobs",
                headers=self.headers(),
                params={
                    "status": "in.(pending,retry,unknown)",
                    "scheduled_for": f"lte.{current.isoformat()}",
                    "or": f"(next_attempt_at.is.null,next_attempt_at.lte.{current.isoformat()})",
                    "select": "*,calendar_events(*)",
                    "order": "scheduled_for.asc",
                    "limit": str(limit),
                },
            )
            if response.status_code != 200:
                raise ApiError(
                    502, "notification_jobs_unavailable", "알림 작업을 불러오지 못했습니다."
                )
            jobs = response.json()
            profile_cache: dict[str, dict[str, Any]] = {}
            for job in jobs:
                if not await self._claim_job(client, job):
                    continue
                result.processed += 1
                event = job.get("calendar_events") or {}
                title = event.get("title") or "다가오는 일정"
                body = notification_body(
                    title,
                    event.get("event_type", "review"),
                    int(job.get("days_before") or 0),
                )
                if job["channel"] == "in_app":
                    payload = {
                        "user_id": job["user_id"],
                        "item_id": job["item_id"],
                        "event_id": job["event_id"],
                        "job_id": job["id"],
                        "title": title,
                        "body": body,
                        "target_path": f"/items/{job['item_id']}",
                    }
                    insert = await client.post(
                        f"{self.settings.normalized_supabase_url}/rest/v1/in_app_notifications?on_conflict=job_id",
                        headers={**self.headers(), "Prefer": "resolution=ignore-duplicates"},
                        json=payload,
                    )
                    status = "sent" if insert.status_code in (200, 201) else "failed"
                    await self._patch_job(
                        client,
                        job["id"],
                        {
                            "status": status,
                            "processed_at": current.isoformat(),
                            "last_error": None if status == "sent" else "in_app_insert_failed",
                        },
                    )
                    if status == "sent":
                        result.sent += 1
                    else:
                        result.failed += 1
                    continue

                user_id = job["user_id"]
                if user_id not in profile_cache:
                    profile_response = await client.get(
                        f"{self.settings.normalized_supabase_url}/rest/v1/profiles",
                        headers=self.headers(),
                        params={
                            "id": f"eq.{user_id}",
                            "select": "timezone,quiet_hours_start,quiet_hours_end",
                            "limit": "1",
                        },
                    )
                    profile_cache[user_id] = (profile_response.json() or [{}])[0]
                profile = profile_cache[user_id]
                delayed_until = quiet_time_delay(
                    current,
                    profile.get("timezone", "Asia/Seoul"),
                    profile.get("quiet_hours_start", "22:00"),
                    profile.get("quiet_hours_end", "08:00"),
                )
                if delayed_until:
                    event_date = event.get("event_date")
                    local_delayed_date = (
                        delayed_until.astimezone(ZoneInfo(profile.get("timezone", "Asia/Seoul")))
                        .date()
                        .isoformat()
                    )
                    if event_date and local_delayed_date > event_date:
                        await self._patch_job(
                            client,
                            job["id"],
                            {
                                "status": "skipped",
                                "processed_at": current.isoformat(),
                                "last_error": "expired_during_quiet_hours",
                            },
                        )
                        result.skipped += 1
                    else:
                        await self._patch_job(
                            client,
                            job["id"],
                            {
                                "status": "retry",
                                "next_attempt_at": delayed_until.isoformat(),
                                "last_error": "quiet_hours",
                            },
                        )
                        result.delayed += 1
                    continue

                if not self.settings.vapid_private_key or not self.settings.vapid_public_key:
                    await self._patch_job(
                        client,
                        job["id"],
                        {
                            "status": "failed",
                            "processed_at": current.isoformat(),
                            "last_error": "vapid_not_configured",
                        },
                    )
                    result.failed += 1
                    continue
                subscriptions = await client.get(
                    f"{self.settings.normalized_supabase_url}/rest/v1/push_subscriptions",
                    headers=self.headers(),
                    params={"user_id": f"eq.{user_id}", "select": "*"},
                )
                devices = subscriptions.json() if subscriptions.status_code == 200 else []
                if not devices:
                    await self._patch_job(
                        client,
                        job["id"],
                        {
                            "status": "skipped",
                            "processed_at": current.isoformat(),
                            "last_error": "no_push_subscription",
                        },
                    )
                    result.skipped += 1
                    continue
                try:
                    payload = json.dumps(
                        {"title": title, "body": body, "url": f"/items/{job['item_id']}"},
                        ensure_ascii=False,
                    )
                    for device in devices:
                        await self._send_push(device, payload)
                    await self._patch_job(
                        client,
                        job["id"],
                        {"status": "sent", "processed_at": current.isoformat(), "last_error": None},
                    )
                    result.sent += 1
                except Exception as error:
                    attempts = int(job["attempts"]) + 1
                    if attempts < self.settings.notification_max_attempts:
                        minutes = (5, 30)[min(attempts - 1, 1)]
                        await self._patch_job(
                            client,
                            job["id"],
                            {
                                "status": "unknown",
                                "next_attempt_at": (
                                    current + timedelta(minutes=minutes)
                                ).isoformat(),
                                "last_error": type(error).__name__,
                            },
                        )
                        result.unknown += 1
                    else:
                        await self._patch_job(
                            client,
                            job["id"],
                            {
                                "status": "failed",
                                "processed_at": current.isoformat(),
                                "last_error": type(error).__name__,
                            },
                        )
                        result.failed += 1
        return result


@lru_cache
def get_notification_service() -> NotificationService:
    return NotificationService(get_settings())
