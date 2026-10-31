import time
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app.clock import clock
from app.errors import ConflictError, NotFoundError
from app.models.billing import Invoice
from app.models.platform import OutboxMessage
from app.schemas.invoice import BulkInvoiceActionResult, BulkInvoiceItemResult
from app.services.audit import log_audit


def get_overdue_filter(today: Optional[date] = None):
    """Return the single authoritative filter condition for overdue invoices.

    Definition: status confirmed AND due_date < today AND amount_paid < total.
    """
    if today is None:
        today = clock.today()
    return [
        Invoice.status == "confirmed",
        Invoice.due_date < today,
        Invoice.amount_paid < Invoice.total,
    ]


def get_overdue_invoices_query(db: Session, today: Optional[date] = None):
    """Return the single authoritative query for overdue invoices using the shared filter."""
    return db.query(Invoice).filter(*get_overdue_filter(today))


def derive_payment_status(inv: Invoice, today: date) -> str:
    """Derive display status: Paid, Partially paid, Outstanding, Overdue, Draft, Cancelled (PLAN.md 5.7)."""
    if inv.status == "cancelled":
        return "Cancelled"
    if inv.status == "draft":
        return "Draft"
    if inv.amount_paid >= inv.total:
        return "Paid"
    if inv.status == "confirmed" and inv.due_date < today and inv.amount_paid < inv.total:
        return "Overdue"
    if inv.amount_paid > 0:
        return "Partially paid"
    return "Outstanding"


def generate_invoice_html(inv: Invoice) -> str:
    """Generate responsive, print-optimized HTML invoice layout."""
    lines_html = ""
    for line in inv.lines:
        lines_html += f"""
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{line.description}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">{line.quantity}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">{inv.currency} {line.unit_price:.2f}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">{inv.currency} {line.discount_amount:.2f}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">{inv.currency} {line.tax_amount:.2f}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: bold;">{inv.currency} {line.line_total:.2f}</td>
        </tr>
        """

    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8" />
        <title>Invoice {inv.number}</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; margin: 0; padding: 24px; background: #fff; }}
            .container {{ max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px; }}
            .header {{ display: flex; justify-content: space-between; border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 24px; }}
            .brand {{ font-size: 26px; font-weight: 800; color: #4f46e5; }}
            .meta {{ text-align: right; }}
            .meta h1 {{ margin: 0; font-size: 20px; }}
            .info-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }}
            table {{ width: 100%; border-collapse: collapse; margin-bottom: 24px; }}
            th {{ background: #f8fafc; padding: 10px; text-align: left; font-size: 13px; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }}
            .totals {{ margin-left: auto; width: 300px; }}
            .totals-row {{ display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }}
            .totals-row.grand {{ font-size: 18px; font-weight: bold; border-top: 2px solid #4f46e5; border-bottom: none; padding-top: 10px; }}
            @media print {{
                body {{ padding: 0; }}
                .container {{ border: none; padding: 0; max-width: 100%; }}
                .no-print {{ display: none; }}
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div>
                    <div class="brand">OrbitLedger</div>
                    <div style="color: #64748b; font-size: 13px;">Subscription Management Cloud</div>
                </div>
                <div class="meta">
                    <h1>INVOICE</h1>
                    <div style="font-weight: bold; color: #4f46e5;">{inv.number}</div>
                    <div style="font-size: 13px; color: #64748b;">Issue Date: {inv.issue_date}</div>
                    <div style="font-size: 13px; color: #64748b;">Due Date: {inv.due_date}</div>
                </div>
            </div>

            <div class="info-grid">
                <div>
                    <div style="font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase;">Billed To:</div>
                    <div style="font-weight: bold; font-size: 16px;">{inv.customer.name}</div>
                    <div>{inv.customer.company or ""}</div>
                    <div>{inv.customer.email}</div>
                    <div>{inv.customer.billing_address or ""}</div>
                    {f"<div>Tax ID: {inv.customer.tax_id}</div>" if inv.customer.tax_id else ""}
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase;">Subscription Period:</div>
                    <div style="font-weight: 600;">{inv.period_start} to {inv.period_end}</div>
                    <div style="margin-top: 8px; font-size: 13px;">
                        Status: <span style="font-weight: bold; text-transform: uppercase;">{inv.status}</span>
                    </div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Description</th>
                        <th style="text-align: center;">Qty</th>
                        <th style="text-align: right;">Unit Price</th>
                        <th style="text-align: right;">Discount</th>
                        <th style="text-align: right;">Tax</th>
                        <th style="text-align: right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {lines_html}
                </tbody>
            </table>

            <div class="totals">
                <div class="totals-row">
                    <span>Subtotal:</span>
                    <span>{inv.currency} {inv.subtotal:.2f}</span>
                </div>
                <div class="totals-row">
                    <span>Discount:</span>
                    <span>-{inv.currency} {inv.discount_total:.2f}</span>
                </div>
                <div class="totals-row">
                    <span>Tax:</span>
                    <span>+{inv.currency} {inv.tax_total:.2f}</span>
                </div>
                <div class="totals-row grand">
                    <span>Total Amount:</span>
                    <span>{inv.currency} {inv.total:.2f}</span>
                </div>
                <div class="totals-row" style="color: #059669; font-weight: 600;">
                    <span>Amount Paid:</span>
                    <span>{inv.currency} {inv.amount_paid:.2f}</span>
                </div>
                <div class="totals-row" style="color: #dc2626; font-weight: 700;">
                    <span>Balance Due:</span>
                    <span>{inv.currency} {max(Decimal('0.00'), inv.total - inv.amount_paid):.2f}</span>
                </div>
            </div>

            <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
                Thank you for your business! For inquiries, contact billing@brightloop.test
            </div>
        </div>
    </body>
    </html>
    """


def confirm_invoice(
    db: Session,
    invoice_id: int,
    actor_id: Optional[int] = None,
    expected_version: Optional[int] = None,
    request_id: Optional[str] = None,
) -> Invoice:
    """Transition invoice from draft -> confirmed. Confirmed invoices become immutable."""
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise NotFoundError("Invoice not found")

    if inv.status != "draft":
        raise ConflictError(f"Cannot confirm invoice in '{inv.status}' status")

    if expected_version is not None and inv.version != expected_version:
        raise ConflictError("Invoice was modified by another operation", code="CONCURRENCY_CONFLICT")

    inv.status = "confirmed"
    inv.version += 1

    log_audit(
        db=db,
        actor_id=actor_id,
        action="invoice.confirmed",
        entity_type="invoice",
        entity_id=inv.id,
        after={"status": "confirmed", "number": inv.number},
        request_id=request_id,
    )
    db.commit()
    db.refresh(inv)
    return inv


def cancel_invoice(
    db: Session,
    invoice_id: int,
    actor_id: Optional[int] = None,
    reason: Optional[str] = None,
    request_id: Optional[str] = None,
) -> Invoice:
    """Cancel invoice (only permitted from draft, or confirmed with zero payments)."""
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise NotFoundError("Invoice not found")

    if inv.status == "paid":
        raise ConflictError("Cannot cancel a paid invoice")
    if inv.amount_paid > 0:
        raise ConflictError("Cannot cancel an invoice with recorded payments")
    if inv.status == "cancelled":
        return inv

    before_status = inv.status
    inv.status = "cancelled"
    inv.version += 1

    log_audit(
        db=db,
        actor_id=actor_id,
        action="invoice.cancelled",
        entity_type="invoice",
        entity_id=inv.id,
        before={"status": before_status},
        after={"status": "cancelled", "reason": reason},
        request_id=request_id,
    )
    db.commit()
    db.refresh(inv)
    return inv


def send_invoice(
    db: Session,
    invoice_id: int,
    actor_id: Optional[int] = None,
    request_id: Optional[str] = None,
) -> Invoice:
    """Enqueue invoice HTML into outbox queue and record sent_at timestamp."""
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise NotFoundError("Invoice not found")

    if inv.status == "draft":
        raise ConflictError("Please confirm invoice before sending to customer")

    html_body = generate_invoice_html(inv)
    dedupe = f"inv_send_{inv.id}_{int(time.time())}"

    msg = OutboxMessage(
        to_email=inv.customer.email,
        subject=f"Your Invoice {inv.number} from OrbitLedger",
        body_html=html_body,
        kind="invoice_sent",
        status="pending",
        dedupe_key=dedupe,
    )
    db.add(msg)
    inv.sent_at = datetime.now(timezone.utc)
    inv.version += 1

    log_audit(
        db=db,
        actor_id=actor_id,
        action="invoice.sent",
        entity_type="invoice",
        entity_id=inv.id,
        after={"sent_at": inv.sent_at.isoformat(), "recipient": inv.customer.email},
        request_id=request_id,
    )
    db.commit()
    db.refresh(inv)
    return inv


def bulk_invoice_action(
    db: Session,
    invoice_ids: List[int],
    action: str,
    actor_id: Optional[int] = None,
    request_id: Optional[str] = None,
) -> BulkInvoiceActionResult:
    """Execute bulk confirm or send with granular per-row result reporting."""
    results: List[BulkInvoiceItemResult] = []
    succeeded = 0
    failed = 0

    for inv_id in invoice_ids:
        try:
            if action == "confirm":
                confirm_invoice(db, inv_id, actor_id=actor_id, request_id=request_id)
                results.append(BulkInvoiceItemResult(id=inv_id, success=True, status="confirmed"))
                succeeded += 1
            elif action == "send":
                send_invoice(db, inv_id, actor_id=actor_id, request_id=request_id)
                results.append(BulkInvoiceItemResult(id=inv_id, success=True, status="sent"))
                succeeded += 1
            else:
                results.append(BulkInvoiceItemResult(id=inv_id, success=False, error=f"Unknown action: {action}"))
                failed += 1
        except Exception as e:
            results.append(BulkInvoiceItemResult(id=inv_id, success=False, error=str(e)))
            failed += 1

    return BulkInvoiceActionResult(
        total_processed=len(invoice_ids),
        succeeded=succeeded,
        failed=failed,
        results=results,
    )
