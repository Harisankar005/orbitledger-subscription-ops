from sqlalchemy.orm import Session

from app.models.billing import Invoice, NumberCounter
from app.models.subscription import Subscription


def generate_next_number(session: Session, prefix: str) -> str:
    """Generate sequential number format (e.g. SUB-000001 or INV-000001) using row-locked counter.

    PostgreSQL uses FOR UPDATE row-level locking to avoid race conditions.
    SQLite runs inside the transaction.
    """
    query = session.query(NumberCounter).filter(NumberCounter.name == prefix)
    if session.bind and session.bind.dialect.name == "postgresql":
        query = query.with_for_update()

    counter = query.first()
    if not counter:
        counter = NumberCounter(name=prefix, next_value=1)
        session.add(counter)
        session.flush()

    while True:
        assigned_number = f"{prefix}-{counter.next_value:06d}"
        counter.next_value += 1

        already_exists = False
        if prefix == "SUB":
            already_exists = session.query(Subscription.id).filter(Subscription.number == assigned_number).first() is not None
        elif prefix == "INV":
            already_exists = session.query(Invoice.id).filter(Invoice.number == assigned_number).first() is not None

        if not already_exists:
            session.flush()
            return assigned_number

