from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.api.deps import get_entitled_membership
from app.database import get_db
from app.models.models import Vendor, PurchaseRegisterRecord, OrganizationMember

router = APIRouter(prefix="/vendors", tags=["Vendors"])

@router.get("")
def list_vendors(
    search: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db),
):
    org_id = membership.organization_id
    query = db.query(
        PurchaseRegisterRecord.supplier_gstin.label("gstin"),
        func.count(PurchaseRegisterRecord.id).label("invoice_count"),
        func.sum(PurchaseRegisterRecord.taxable_value).label("taxable_total"),
        func.sum(
            PurchaseRegisterRecord.igst + PurchaseRegisterRecord.cgst
            + PurchaseRegisterRecord.sgst + PurchaseRegisterRecord.cess
        ).label("tax_total"),
        func.max(PurchaseRegisterRecord.invoice_date).label("last_invoice_date"),
        Vendor.name.label("vendor_name"),
        Vendor.email.label("email"),
        Vendor.phone.label("phone"),
    ).outerjoin(
        Vendor,
        (Vendor.organization_id == org_id)
        & (Vendor.gstin == PurchaseRegisterRecord.supplier_gstin),
    ).filter(
        PurchaseRegisterRecord.organization_id == org_id
    ).group_by(
        PurchaseRegisterRecord.supplier_gstin, Vendor.name, Vendor.email, Vendor.phone
    )
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            PurchaseRegisterRecord.supplier_gstin.ilike(term)
            | Vendor.name.ilike(term)
        )
    total = query.count()
    rows = query.order_by(func.sum(PurchaseRegisterRecord.taxable_value).desc()).offset(offset).limit(limit).all()
    return {
        "total": total, "offset": offset, "limit": limit,
        "vendors": [{
            "gstin": row.gstin,
            "name": row.vendor_name or row.gstin,
            "email": row.email,
            "phone": row.phone,
            "invoice_count": int(row.invoice_count or 0),
            "taxable_value": str(row.taxable_total or 0),
            "tax_amount": str(row.tax_total or 0),
            "last_invoice_date": row.last_invoice_date.isoformat() if row.last_invoice_date else None,
            "name_is_gstin_fallback": not bool(row.vendor_name),
        } for row in rows]
    }
