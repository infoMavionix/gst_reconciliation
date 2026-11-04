import hashlib
import hmac
import uuid
from datetime import datetime, timedelta
from typing import Any

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_membership
from app.core.config import settings
from app.database import get_db
from app.models.models import (
    AuditLog, OrganizationSubscription, Payment, SubscriptionPlan
)

router = APIRouter(prefix="/billing", tags=["Billing"])

# Indicative starter prices. Change these values before production launch.
DEFAULT_PLANS = [
    {"code": "STARTER", "name": "Starter", "description": "For small teams getting started with GST reconciliation.", "amount_paise": 99900, "max_users": 3, "display_order": 1},
    {"code": "GROWTH", "name": "Growth", "description": "For growing businesses handling more monthly invoices.", "amount_paise": 249900, "max_users": 10, "display_order": 2},
    {"code": "BUSINESS", "name": "Business", "description": "For larger finance teams and multiple reviewers.", "amount_paise": 499900, "max_users": 25, "display_order": 3},
]

def ensure_default_plans(db: Session):
    for item in DEFAULT_PLANS:
        plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.code == item["code"]).first()
        if not plan:
            db.add(SubscriptionPlan(**item, currency="INR", billing_interval="monthly", is_active=True))
    db.commit()

def require_razorpay():
    if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET or "REPLACE" in settings.RAZORPAY_KEY_ID:
        raise HTTPException(status_code=503, detail="Online payments are not configured yet. Please contact support.")

def razorpay_request(method: str, path: str, payload: dict | None = None) -> dict:
    require_razorpay()
    try:
        response = requests.request(
            method,
            f"https://api.razorpay.com/v1/{path.lstrip('/')}",
            json=payload,
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
            timeout=20,
        )
        data = response.json()
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Payment gateway is temporarily unavailable")
    if response.status_code >= 400:
        detail = data.get("error", {}).get("description", "Payment gateway request failed")
        raise HTTPException(status_code=502, detail=detail)
    return data

def get_org_subscription(db: Session, organization_id: int) -> OrganizationSubscription:
    sub = db.query(OrganizationSubscription).filter(
        OrganizationSubscription.organization_id == organization_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription record not found")
    return sub

def current_status(sub: OrganizationSubscription) -> str:
    now = datetime.utcnow()
    if sub.status == "TRIALING" and now >= sub.trial_ends_at:
        return "TRIAL_EXPIRED"
    if sub.status == "ACTIVE" and sub.current_period_end and now >= sub.current_period_end:
        return "EXPIRED"
    return sub.status

@router.get("/plans")
def list_plans(db: Session = Depends(get_db)):
    ensure_default_plans(db)
    plans = db.query(SubscriptionPlan).filter(SubscriptionPlan.is_active.is_(True)).order_by(SubscriptionPlan.display_order).all()
    return [{
        "id": p.id, "code": p.code, "name": p.name, "description": p.description,
        "amount_paise": p.amount_paise, "amount_rupees": p.amount_paise / 100,
        "currency": p.currency, "billing_interval": p.billing_interval,
        "max_users": p.max_users,
    } for p in plans]

@router.get("/status")
def billing_status(
    membership=Depends(get_current_membership),
    db: Session = Depends(get_db),
):
    sub = get_org_subscription(db, membership.organization_id)
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first() if sub.plan_id else None
    status = current_status(sub)
    now = datetime.utcnow()
    end = sub.trial_ends_at if status == "TRIALING" else sub.current_period_end
    days_remaining = max(0, (end.date() - now.date()).days) if end else 0
    return {
        "status": status,
        "trial_starts_at": sub.trial_starts_at.isoformat(),
        "trial_ends_at": sub.trial_ends_at.isoformat(),
        "days_remaining": days_remaining,
        "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "plan": {"id": plan.id, "name": plan.name, "amount_paise": plan.amount_paise, "currency": plan.currency} if plan else None,
        "can_use_app": status in ("TRIALING", "ACTIVE"),
    }

class CreateOrderRequest(BaseModel):
    plan_id: int = Field(gt=0)

@router.post("/create-order")
def create_order(
    payload: CreateOrderRequest,
    membership=Depends(get_current_membership),
    db: Session = Depends(get_db),
):
    require_razorpay()
    sub = get_org_subscription(db, membership.organization_id)
    if current_status(sub) not in ("TRIALING", "TRIAL_EXPIRED", "EXPIRED", "ACTIVE"):
        raise HTTPException(status_code=400, detail="This subscription cannot be renewed at this time")
    plan = db.query(SubscriptionPlan).filter(
        SubscriptionPlan.id == payload.plan_id,
        SubscriptionPlan.is_active.is_(True),
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Selected plan was not found")
    order = razorpay_request("POST", "/orders", {
        "amount": plan.amount_paise,
        "currency": plan.currency,
        "receipt": f"gst-org-{membership.organization_id}-{int(datetime.utcnow().timestamp())}",
        "notes": {
            "organization_id": str(membership.organization_id),
            "subscription_id": str(sub.id),
            "plan_id": str(plan.id),
        },
    })
    payment = Payment(
        organization_id=membership.organization_id,
        subscription_id=sub.id,
        plan_id=plan.id,
        amount_paise=plan.amount_paise,
        currency=plan.currency,
        status="CREATED",
        razorpay_order_id=order["id"],
    )
    db.add(payment)
    db.add(AuditLog(organization_id=membership.organization_id, user_id=membership.user_id,
                    action="PAYMENT_ORDER_CREATED", entity_type="payment", entity_id=order["id"],
                    details={"plan_code": plan.code, "amount_paise": plan.amount_paise}))
    db.commit()
    return {
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "razorpay_key_id": settings.RAZORPAY_KEY_ID,
        "plan_name": plan.name,
        "company_name": "GST Reconciliation",
    }


class DemoActivateRequest(BaseModel):
    plan_id: int = Field(gt=0)


@router.post("/demo-activate")
def demo_activate(
    payload: DemoActivateRequest,
    membership=Depends(get_current_membership),
    db: Session = Depends(get_db),
):
    """Simulate a successful subscription payment for local development only."""
    if settings.ENVIRONMENT.lower() != "development" or not settings.ENABLE_DEMO_PAYMENTS:
        raise HTTPException(status_code=404, detail="Demo payment is disabled")

    plan = db.query(SubscriptionPlan).filter(
        SubscriptionPlan.id == payload.plan_id,
        SubscriptionPlan.is_active.is_(True),
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Selected plan was not found")

    sub = get_org_subscription(db, membership.organization_id)
    now = datetime.utcnow()
    demo_id = uuid.uuid4().hex
    payment = Payment(
        organization_id=membership.organization_id,
        subscription_id=sub.id,
        plan_id=plan.id,
        amount_paise=plan.amount_paise,
        currency=plan.currency,
        status="PAID",
        razorpay_order_id=f"DEMO-ORDER-{demo_id}",
        razorpay_payment_id=f"DEMO-PAY-{demo_id}",
        paid_at=now,
    )
    sub.plan_id = plan.id
    sub.status = "ACTIVE"
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=30)
    db.add(payment)
    db.add(AuditLog(
        organization_id=membership.organization_id,
        user_id=membership.user_id,
        action="DEMO_PAYMENT_ACTIVATED",
        entity_type="payment",
        entity_id=f"DEMO-PAY-{demo_id}",
        details={"plan_code": plan.code, "amount_paise": plan.amount_paise, "no_money_charged": True},
    ))
    db.commit()
    return {"status": "PAID", "demo": True, "message": "Demo payment successful. Plan activated for 30 days. No money was charged."}


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

@router.post("/verify-payment")
def verify_payment(
    payload: VerifyPaymentRequest,
    membership=Depends(get_current_membership),
    db: Session = Depends(get_db),
):
    require_razorpay()
    expected = hmac.new(
        settings.RAZORPAY_KEY_SECRET.encode(),
        f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    payment = db.query(Payment).filter(
        Payment.razorpay_order_id == payload.razorpay_order_id,
        Payment.organization_id == membership.organization_id,
    ).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment order not found")
    if payment.status == "PAID":
        return {"status": "PAID", "message": "Payment was already verified"}

    # Confirm the payment directly with Razorpay before granting paid access.
    gateway_payment = razorpay_request("GET", f"/payments/{payload.razorpay_payment_id}")
    if gateway_payment.get("order_id") != payload.razorpay_order_id or gateway_payment.get("status") != "captured":
        raise HTTPException(status_code=400, detail="Payment is not successful or does not match this order")
    if gateway_payment.get("amount") != payment.amount_paise or gateway_payment.get("currency") != payment.currency:
        raise HTTPException(status_code=400, detail="Payment amount or currency does not match the order")

    sub = get_org_subscription(db, membership.organization_id)
    now = datetime.utcnow()
    payment.status = "PAID"
    payment.razorpay_payment_id = payload.razorpay_payment_id
    payment.razorpay_signature = payload.razorpay_signature
    payment.paid_at = now
    sub.plan_id = payment.plan_id
    sub.status = "ACTIVE"
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=30)
    db.add(AuditLog(organization_id=membership.organization_id, user_id=membership.user_id,
                    action="PAYMENT_VERIFIED", entity_type="payment", entity_id=payload.razorpay_payment_id,
                    details={"amount_paise": payment.amount_paise, "currency": payment.currency}))
    db.commit()
    return {"status": "PAID", "message": "Payment verified and subscription activated"}

@router.post("/webhook")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if not settings.RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook secret is not configured")
    body = await request.body()
    expected = hmac.new(settings.RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not x_razorpay_signature or not hmac.compare_digest(expected, x_razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    import json
    event = json.loads(body.decode("utf-8"))
    if event.get("event") != "payment.captured":
        return {"received": True, "processed": False}
    entity = event.get("payload", {}).get("payment", {}).get("entity", {})
    order_id = entity.get("order_id")
    payment_id = entity.get("id")
    if not order_id or not payment_id:
        return {"received": True, "processed": False}
    payment = db.query(Payment).filter(Payment.razorpay_order_id == order_id).first()
    if not payment:
        return {"received": True, "processed": False}
    if payment.status == "PAID":
        return {"received": True, "processed": True}
    if entity.get("amount") != payment.amount_paise or entity.get("currency") != payment.currency:
        raise HTTPException(status_code=400, detail="Webhook payment amount mismatch")
    sub = get_org_subscription(db, payment.organization_id)
    now = datetime.utcnow()
    payment.status = "PAID"
    payment.razorpay_payment_id = payment_id
    payment.paid_at = now
    sub.plan_id = payment.plan_id
    sub.status = "ACTIVE"
    sub.current_period_start = now
    sub.current_period_end = now + timedelta(days=30)
    db.add(AuditLog(organization_id=payment.organization_id, user_id=None,
                    action="PAYMENT_CAPTURED_WEBHOOK", entity_type="payment", entity_id=payment_id,
                    details={"amount_paise": payment.amount_paise}))
    db.commit()
    return {"received": True, "processed": True}
