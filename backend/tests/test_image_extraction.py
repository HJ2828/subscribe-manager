from app.config import Settings
from app.image_service import ImageService


def test_sanitize_keeps_only_explicitly_detected_fields_and_selected_type() -> None:
    service = ImageService(Settings())
    extraction = {
        "management_type": "recurring_subscription",
        "service_name": "아메리카노 교환권",
        "provider_name": "예시 카페",
        "amount": 5000,
        "currency": "KRW",
        "target_date_value": "2027-12-31",
        "target_date_precision": "day",
        "actual_status": "in_use",
        "detected_fields": [
            {
                "field": "service_name",
                "value": "아메리카노 교환권",
                "evidence": "상품명이 보임",
                "confidence": "high",
            },
            {
                "field": "provider_name",
                "value": "예시 카페",
                "evidence": "사용처가 보임",
                "confidence": "high",
            },
        ],
    }

    result = service._sanitize_extraction(extraction, "gifticon")

    assert result["management_type"] == "gifticon"
    assert result["service_name"] == "아메리카노 교환권"
    assert result["provider_name"] == "예시 카페"
    assert result["amount"] is None
    assert result["currency"] is None
    assert result["target_date_value"] is None
    assert result["target_date_precision"] is None
    assert result["actual_status"] is None


def test_sanitize_removes_sensitive_or_unknown_detected_fields() -> None:
    service = ImageService(Settings())
    extraction = {
        "service_name": "보증서",
        "account_id": "secret",
        "detected_fields": [
            {"field": "account_id", "value": "secret", "evidence": "", "confidence": "high"},
            {"field": "unknown", "value": "x", "evidence": "", "confidence": "low"},
        ],
    }

    result = service._sanitize_extraction(extraction, "warranty")

    assert "account_id" not in result
    assert result["detected_fields"] == []
    assert result["service_name"] is None
