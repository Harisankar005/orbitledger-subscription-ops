"""Clock service for deterministic and time-travel testable operations.

Rule 7: Clock is injected; never call date.today() directly.
Business timezone Asia/Kolkata, stored dates are plain dates, timestamps UTC.
"""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from dateutil.relativedelta import relativedelta
from app.config import settings


class ClockService:
    def __init__(self, tz_name: str = settings.TIMEZONE):
        self.tz = ZoneInfo(tz_name)
        self.offset_delta = relativedelta()

    def now(self) -> datetime:
        """Return current simulated UTC timestamp with timezone."""
        base_utc = datetime.now(timezone.utc)
        return base_utc + self.offset_delta

    def now_local(self) -> datetime:
        """Return current simulated local datetime in business timezone."""
        return self.now().astimezone(self.tz)

    def today(self) -> date:
        """Return current simulated business date (Asia/Kolkata)."""
        return self.now_local().date()

    def advance_days(self, days: int) -> date:
        """Advance simulated clock by n days (for time travel tests)."""
        self.offset_delta += relativedelta(days=days)
        return self.today()

    def advance_months(self, months: int) -> date:
        """Advance simulated clock by n months (for demo time-travel)."""
        self.offset_delta += relativedelta(months=months)
        return self.today()

    def set_date(self, target_date: date) -> date:
        """Set simulated clock date directly."""
        current_today = datetime.now(self.tz).date()
        diff_days = (target_date - current_today).days
        self.offset_delta = relativedelta(days=diff_days)
        return self.today()

    def reset(self) -> date:
        """Reset time-travel offsets to actual real-world clock."""
        self.offset_delta = relativedelta()
        return self.today()


# Global singleton clock instance
clock = ClockService()
