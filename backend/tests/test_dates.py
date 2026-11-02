import pytest
from pydantic import ValidationError

from app.domain.dates import DatePrecision, PartialDate


def test_month_precision_does_not_invent_a_day() -> None:
    value = PartialDate(year=2025, month=1, precision=DatePrecision.MONTH)

    assert value.day is None
    assert value.timezone == "Asia/Seoul"


def test_day_precision_validates_calendar_date() -> None:
    with pytest.raises(ValidationError):
        PartialDate(year=2025, month=2, day=30, precision=DatePrecision.DAY)


def test_year_precision_rejects_month_and_day() -> None:
    with pytest.raises(ValidationError):
        PartialDate(year=2025, month=1, precision=DatePrecision.YEAR)
