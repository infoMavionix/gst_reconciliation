from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String,
    Text, UniqueConstraint, JSON, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    memberships: Mapped[list["OrganizationMember"]] = relationship(back_populates="user")

class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(250))
    gstin: Mapped[str | None] = mapped_column(String(15), index=True)
    pan: Mapped[str | None] = mapped_column(String(10))
    business_email: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    memberships: Mapped[list["OrganizationMember"]] = relationship(back_populates="organization")

class OrganizationMember(Base):
    __tablename__ = "organization_members"
    __table_args__ = (UniqueConstraint("organization_id", "user_id", name="uq_org_member"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30), default="MEMBER", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    user: Mapped["User"] = relationship(back_populates="memberships")
    organization: Mapped["Organization"] = relationship(back_populates="memberships")

class Vendor(Base):
    __tablename__ = "vendors"
    __table_args__ = (UniqueConstraint("organization_id", "gstin", name="uq_vendor_org_gstin"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    gstin: Mapped[str] = mapped_column(String(15), nullable=False)
    name: Mapped[str] = mapped_column(String(250), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

class GstPeriod(Base):
    __tablename__ = "gst_periods"
    __table_args__ = (UniqueConstraint("organization_id", "financial_year", "return_period", name="uq_gst_period_org"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    financial_year: Mapped[str] = mapped_column(String(9), nullable=False)
    return_period: Mapped[str] = mapped_column(String(6), nullable=False)  # e.g. 042026
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="OPEN", nullable=False)

class UploadBatch(Base):
    __tablename__ = "upload_batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    gst_period_id: Mapped[int | None] = mapped_column(ForeignKey("gst_periods.id", ondelete="SET NULL"))
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)  # PURCHASE_REGISTER / GSTR2B
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(500))  # private S3 object key in later phase
    file_sha256: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default="UPLOADED", nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_summary: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

class PurchaseRegisterRecord(Base):
    __tablename__ = "purchase_register"
    __table_args__ = (
        Index("ix_purchase_org_period_invoice", "organization_id", "gst_period_id", "invoice_number_normalized"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    upload_batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id", ondelete="CASCADE"), index=True)
    gst_period_id: Mapped[int] = mapped_column(ForeignKey("gst_periods.id"), index=True)
    supplier_gstin: Mapped[str] = mapped_column(String(15), nullable=False, index=True)
    invoice_number_original: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_number_normalized: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    igst: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    cgst: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    sgst: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    cess: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    source_row_number: Mapped[int | None] = mapped_column(Integer)

class Gstr2BRecord(Base):
    __tablename__ = "gstr2b_records"
    __table_args__ = (
        Index("ix_gstr2b_org_period_invoice", "organization_id", "gst_period_id", "invoice_number_normalized"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    upload_batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id", ondelete="CASCADE"), index=True)
    gst_period_id: Mapped[int] = mapped_column(ForeignKey("gst_periods.id"), index=True)
    supplier_gstin: Mapped[str] = mapped_column(String(15), nullable=False, index=True)
    invoice_number_original: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_number_normalized: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_date: Mapped[date | None] = mapped_column(Date)
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    igst: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    cgst: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    sgst: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    cess: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
    itc_availability: Mapped[str | None] = mapped_column(String(30))
    filing_date: Mapped[date | None] = mapped_column(Date)
    source_row_number: Mapped[int | None] = mapped_column(Integer)

class ReconciliationRun(Base):
    __tablename__ = "reconciliation_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    gst_period_id: Mapped[int] = mapped_column(ForeignKey("gst_periods.id"), index=True)
    purchase_upload_batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"))
    gstr2b_upload_batch_id: Mapped[int] = mapped_column(ForeignKey("upload_batches.id"))
    initiated_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="PENDING", nullable=False)
    tolerance_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1.00"), nullable=False)
    total_books_records: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_portal_records: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    summary: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)

class ReconciliationResult(Base):
    __tablename__ = "reconciliation_results"
    __table_args__ = (Index("ix_recon_result_run_status", "reconciliation_run_id", "status"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    reconciliation_run_id: Mapped[int] = mapped_column(ForeignKey("reconciliation_runs.id", ondelete="CASCADE"), index=True)
    purchase_record_id: Mapped[int | None] = mapped_column(ForeignKey("purchase_register.id", ondelete="SET NULL"))
    gstr2b_record_id: Mapped[int | None] = mapped_column(ForeignKey("gstr2b_records.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    taxable_difference: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    igst_difference: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    cgst_difference: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    sgst_difference: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    cess_difference: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    review_notes: Mapped[str | None] = mapped_column(Text)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(80))
    details: Mapped[dict | None] = mapped_column(JSON)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    billing_interval: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)
    max_users: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

class OrganizationSubscription(Base):
    __tablename__ = "organization_subscriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, index=True)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("subscription_plans.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(30), default="TRIALING", nullable=False)
    trial_starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    trial_ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("razorpay_payment_id", name="uq_payment_razorpay_payment"),
        Index("ix_payment_org_created", "organization_id", "created_at"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    subscription_id: Mapped[int] = mapped_column(ForeignKey("organization_subscriptions.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("subscription_plans.id"))
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="CREATED", nullable=False)
    razorpay_order_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    razorpay_signature: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
