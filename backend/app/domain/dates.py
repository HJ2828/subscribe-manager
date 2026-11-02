from datetime import date
from enum import StrEnum
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, model_validator


class DatePrecision(StrEnum):
    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class PartialDate(BaseModel):
    year: int = Field(ge=1, le=9999)
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)
    precision: DatePrecision
    timezone: str = "Asia/Seoul"

    @model_validator(mode="after")
    def validate_precision(self) -> "PartialDate":
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError as error:
            raise ValueError("지원되는 시간대 이름을 입력해 주세요.") from error

        if self.precision == DatePrecision.YEAR and (
            self.month is not None or self.day is not None
        ):
            raise ValueError("연도 정밀도에는 월과 일을 저장할 수 없습니다.")
        if self.precision == DatePrecision.MONTH and (self.month is None or self.day is not None):
            raise ValueError("연·월 정밀도에는 월이 필요하고 일은 저장할 수 없습니다.")
        if self.precision == DatePrecision.DAY:
            if self.month is None or self.day is None:
                raise ValueError("일자 정밀도에는 월과 일이 필요합니다.")
            date(self.year, self.month, self.day)

        return self
