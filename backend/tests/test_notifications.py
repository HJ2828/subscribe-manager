from datetime import UTC, datetime

from app.notification_service import notification_body, quiet_time_delay


def test_quiet_hours_delay_to_local_end() -> None:
    delayed = quiet_time_delay(
        datetime(2026, 11, 3, 14, 30, tzinfo=UTC), "Asia/Seoul", "22:00", "08:00"
    )
    assert delayed == datetime(2026, 11, 3, 23, 0, tzinfo=UTC)


def test_daytime_has_no_quiet_hours_delay() -> None:
    assert (
        quiet_time_delay(datetime(2026, 11, 3, 3, 0, tzinfo=UTC), "Asia/Seoul", "22:00", "08:00")
        is None
    )


def test_notification_body_distinguishes_payment_and_expiry_timing() -> None:
    assert notification_body("왓챠", "payment", 3) == "왓챠 결제 3일 전입니다."
    assert notification_body("왓챠", "payment", 0) == "왓챠 결제일입니다."
    assert notification_body("바나나우유", "expiry", 3) == "바나나우유 만료 3일 전입니다."
    assert notification_body("바나나우유", "expiry", 0) == "바나나우유 만료일입니다."
