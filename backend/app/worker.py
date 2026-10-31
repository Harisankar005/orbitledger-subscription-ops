import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import structlog
from apscheduler.schedulers.background import BackgroundScheduler

from app.clock import clock
from app.config import settings
from app.db import SessionLocal
from app.models.billing import Invoice
from app.models.catalog import Plan
from app.models.platform import OutboxMessage
from app.models.subscription import Subscription
from app.services.billing import run_billing_engine
from app.services.subscription import transition_subscription

logger = structlog.get_logger()


def dispatch_outbox_messages():
    """Poll and dispatch pending outbox email messages to Mailpit / SMTP server."""
    with SessionLocal() as db:
        messages = (
            db.query(OutboxMessage)
            .filter(OutboxMessage.status == "pending", OutboxMessage.attempts < 5)
            .order_by(OutboxMessage.created_at.asc())
            .limit(50)
            .all()
        )

        if not messages:
            return

        try:
            smtp_client = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=5)
            if settings.SMTP_TLS:
                smtp_client.starttls()
        except Exception as e:
            logger.warning("outbox_smtp_connect_failed", error=str(e))
            return

        try:
            for msg in messages:
                msg.attempts += 1
                try:
                    mime_msg = MIMEMultipart("alternative")
                    mime_msg["From"] = settings.SMTP_FROM
                    mime_msg["To"] = msg.to_email
                    mime_msg["Subject"] = msg.subject
                    mime_msg.attach(MIMEText(msg.body_html, "html"))

                    smtp_client.sendmail(settings.SMTP_FROM, [msg.to_email], mime_msg.as_string())
                    msg.status = "sent"
                    msg.sent_at = datetime.now(timezone.utc)
                    msg.last_error = None
                except Exception as ex:
                    msg.last_error = str(ex)
                    if msg.attempts >= 5:
                        msg.status = "failed"
            db.commit()
        finally:
            try:
                smtp_client.quit()
            except Exception:
                pass


def job_activate_due_subscriptions():
    """Worker job: Activate confirmed subscriptions reaching start_date."""
    today = clock.today()
    with SessionLocal() as db:
        due_subs = (
            db.query(Subscription)
            .filter(Subscription.status == "confirmed", Subscription.start_date <= today)
            .all()
        )
        for s in due_subs:
            try:
                transition_subscription(
                    db=db,
                    subscription_id=s.id,
                    target_status="active",
                    reason="Automated start_date activation",
                )
            except Exception as e:
                logger.error("worker_activation_error", subscription_id=s.id, error=str(e))


def job_auto_close_expired_subscriptions():
    """Worker job: Auto-close subscriptions past expiry_date if plan.auto_close_on_end is True."""
    today = clock.today()
    with SessionLocal() as db:
        expired_subs = (
            db.query(Subscription)
            .join(Plan, Subscription.plan_id == Plan.id)
            .filter(
                Subscription.status == "active",
                Subscription.expiry_date < today,
                Plan.auto_close_on_end.is_(True),
            )
            .all()
        )
        for s in expired_subs:
            try:
                transition_subscription(
                    db=db,
                    subscription_id=s.id,
                    target_status="closed",
                    reason="Automated auto-close on expiry date reached",
                )
            except Exception as e:
                logger.error("worker_autoclose_error", subscription_id=s.id, error=str(e))


def job_scheduled_billing():
    """Worker job: Nightly idempotent subscription billing run."""
    try:
        run_billing_engine(as_of_date=clock.today(), dry_run=False)
    except Exception as e:
        logger.error("scheduled_billing_run_failed", error=str(e))


def job_dunning_reminders():
    """Worker job (P2): Queue automated reminder emails for upcoming and overdue invoices (due-3d, due, +3d, +7d)."""
    today = clock.today()
    with SessionLocal() as db:
        invoices = (
            db.query(Invoice)
            .filter(
                Invoice.status == "confirmed",
                Invoice.amount_paid < Invoice.total,
            )
            .all()
        )

        for inv in invoices:
            diff_days = (today - inv.due_date).days
            step: Optional[str] = None
            subject_prefix = ""

            if diff_days == -3:
                step = "due_minus_3"
                subject_prefix = "Reminder: Your invoice is due in 3 days"
            elif diff_days == 0:
                step = "due_today"
                subject_prefix = "Invoice Due Today"
            elif diff_days == 3:
                step = "overdue_plus_3"
                subject_prefix = "Urgent: Your invoice is 3 days overdue"
            elif diff_days == 7:
                step = "overdue_plus_7"
                subject_prefix = "Final Notice: Your invoice is 7 days overdue"

            if step:
                dedupe = f"dunning_{inv.id}_{step}"
                existing = db.query(OutboxMessage).filter(OutboxMessage.dedupe_key == dedupe).first()
                if not existing:
                    outstanding = inv.total - inv.amount_paid
                    body = f"""
                    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                        <h2>{subject_prefix} - {inv.number}</h2>
                        <p>Dear {inv.customer.name},</p>
                        <p>This is a notice regarding invoice <strong>{inv.number}</strong>.</p>
                        <ul>
                            <li><strong>Due Date:</strong> {inv.due_date}</li>
                            <li><strong>Total Amount:</strong> {inv.currency} {inv.total}</li>
                            <li><strong>Outstanding Balance:</strong> {inv.currency} {outstanding}</li>
                        </ul>
                        <p>Please arrange payment at your earliest convenience to avoid service disruption.</p>
                    </div>
                    """
                    msg = OutboxMessage(
                        to_email=inv.customer.email,
                        subject=f"{subject_prefix} ({inv.number})",
                        body_html=body,
                        kind="dunning_reminder",
                        status="pending",
                        dedupe_key=dedupe,
                    )
                    db.add(msg)
        db.commit()


def start_scheduler():
    """Start APScheduler in background."""
    scheduler = BackgroundScheduler()
    scheduler.add_job(dispatch_outbox_messages, "interval", seconds=10, id="outbox_dispatcher")
    scheduler.add_job(job_activate_due_subscriptions, "interval", minutes=5, id="sub_activator")
    scheduler.add_job(job_auto_close_expired_subscriptions, "interval", minutes=5, id="sub_closer")
    scheduler.add_job(job_scheduled_billing, "interval", minutes=15, id="billing_runner")
    scheduler.add_job(job_dunning_reminders, "interval", hours=1, id="dunning_checker")
    scheduler.start()
    logger.info("worker_scheduler_started")
    return scheduler


if __name__ == "__main__":
    import time
    logger.info("starting_standalone_worker_process")
    sched = start_scheduler()
    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        sched.shutdown()
