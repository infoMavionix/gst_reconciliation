
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.api.deps import get_current_user, get_entitled_membership
from app.database import get_db
from app.models.models import (
    GstPeriod, UploadBatch, PurchaseRegisterRecord, Gstr2BRecord,
    ReconciliationRun, ReconciliationResult, OrganizationMember, User
)

router = APIRouter(prefix="/reconciliation", tags=["reconciliation"])
ZERO = Decimal("0.00")


class RunRequest(BaseModel):
    period: str = Field(pattern=r"^(0[1-9]|1[0-2])\d{4}$")
    purchase_batch_id: int
    gstr2b_batch_id: int
    tolerance_amount: Decimal = Field(default=Decimal("1.00"), ge=0, le=100000)


def money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def key_for(row) -> tuple[str, str]:
    normalized = (row.invoice_number_normalized or "").strip().upper()
    # Never auto-match records whose invoice number normalized to an empty value.
    if not normalized:
        normalized = f"__EMPTY_INVOICE_ROW_{row.id}"
    return ((row.supplier_gstin or "").strip().upper(), normalized)


def classify(book, portal, tolerance: Decimal):
    diffs = {
        "taxable": money(book.taxable_value) - money(portal.taxable_value),
        "igst": money(book.igst) - money(portal.igst),
        "cgst": money(book.cgst) - money(portal.cgst),
        "sgst": money(book.sgst) - money(portal.sgst),
        "cess": money(book.cess) - money(portal.cess),
    }
    taxable_bad = abs(diffs["taxable"]) > tolerance
    tax_bad = any(abs(diffs[k]) > tolerance for k in ("igst", "cgst", "sgst", "cess"))
    date_bad = bool(book.invoice_date and portal.invoice_date and book.invoice_date != portal.invoice_date)
    if taxable_bad and tax_bad:
        status = "TAXABLE_AND_TAX_MISMATCH"
    elif taxable_bad:
        status = "TAXABLE_MISMATCH"
    elif tax_bad:
        status = "TAX_MISMATCH"
    elif date_bad:
        status = "DATE_MISMATCH"
    else:
        status = "MATCHED"
    notes = []
    if taxable_bad: notes.append("Taxable value differs")
    if tax_bad: notes.append("One or more tax components differ")
    if date_bad: notes.append("Invoice date differs")
    return status, diffs, "; ".join(notes) if notes else "Invoice and tax values are within tolerance"


def result_payload(run_id, org_id, book=None, portal=None, status="", diffs=None, notes=None):
    diffs = diffs or {}
    return ReconciliationResult(
        organization_id=org_id, reconciliation_run_id=run_id,
        purchase_record_id=book.id if book else None,
        gstr2b_record_id=portal.id if portal else None,
        status=status,
        taxable_difference=diffs.get("taxable"),
        igst_difference=diffs.get("igst"),
        cgst_difference=diffs.get("cgst"),
        sgst_difference=diffs.get("sgst"),
        cess_difference=diffs.get("cess"),
        review_notes=notes,
    )


def build_results(books, portals, run_id, org_id, tolerance):
    book_groups, portal_groups = defaultdict(list), defaultdict(list)
    for r in books: book_groups[key_for(r)].append(r)
    for r in portals: portal_groups[key_for(r)].append(r)

    output = []
    for key in sorted(set(book_groups) | set(portal_groups)):
        bg, pg = book_groups.get(key, []), portal_groups.get(key, [])
        if len(bg) > 1 or len(pg) > 1:
            if len(bg) > 1 and len(pg) > 1:
                status, notes = "DUPLICATE_BOTH", "Multiple records share the same GSTIN and normalized invoice number on both sides; manual review required"
            elif len(bg) > 1:
                status, notes = "DUPLICATE_IN_BOOKS", "Multiple Books records share the same GSTIN and normalized invoice number; not auto-matched"
            else:
                status, notes = "DUPLICATE_IN_PORTAL", "Multiple portal records share the same GSTIN and normalized invoice number; not auto-matched"
            # Preserve every source row as its own review item; do not silently drop duplicates.
            for b in bg: output.append(result_payload(run_id, org_id, book=b, status=status, notes=notes))
            for p in pg: output.append(result_payload(run_id, org_id, portal=p, status=status, notes=notes))
        elif bg and pg:
            status, diffs, notes = classify(bg[0], pg[0], tolerance)
            output.append(result_payload(run_id, org_id, bg[0], pg[0], status, diffs, notes))
        elif bg:
            for b in bg:
                output.append(result_payload(run_id, org_id, book=b, status="MISSING_IN_PORTAL",
                    notes="Present in Books but no matching GSTIN + invoice number found in GSTR-2B"))
        else:
            for p in pg:
                output.append(result_payload(run_id, org_id, portal=p, status="MISSING_IN_BOOKS",
                    notes="Present in GSTR-2B but no matching GSTIN + invoice number found in Books"))
    return output


def summarize(results):
    counts = defaultdict(int)
    for r in results: counts[r.status] += 1
    matched = counts["MATCHED"]
    return {
        "total_results": len(results),
        "matched": matched,
        "missing_in_portal": counts["MISSING_IN_PORTAL"],
        "missing_in_books": counts["MISSING_IN_BOOKS"],
        "taxable_mismatch": counts["TAXABLE_MISMATCH"],
        "tax_mismatch": counts["TAX_MISMATCH"],
        "taxable_and_tax_mismatch": counts["TAXABLE_AND_TAX_MISMATCH"],
        "date_mismatch": counts["DATE_MISMATCH"],
        "duplicates": counts["DUPLICATE_IN_BOOKS"] + counts["DUPLICATE_IN_PORTAL"] + counts["DUPLICATE_BOTH"],
        "status_counts": dict(counts),
    }


@router.get("/options")
def reconciliation_options(
    period: str = Query(..., pattern=r"^(0[1-9]|1[0-2])\d{4}$"),
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db),
):
    gst_period = db.query(GstPeriod).filter_by(
        organization_id=membership.organization_id, return_period=period
    ).first()
    if not gst_period:
        return {"period": period, "purchase_batches": [], "gstr2b_batches": []}
    batches = db.query(UploadBatch).filter(
        UploadBatch.organization_id == membership.organization_id,
        UploadBatch.gst_period_id == gst_period.id,
        UploadBatch.status == "IMPORTED",
    ).order_by(UploadBatch.created_at.desc()).all()
    def item(b):
        return {"id": b.id, "filename": b.original_filename, "records": b.total_rows,
                "created_at": b.created_at.isoformat() if b.created_at else None}
    return {
        "period": period,
        "purchase_batches": [item(b) for b in batches if b.source_type == "PURCHASE_REGISTER"],
        "gstr2b_batches": [item(b) for b in batches if b.source_type == "GSTR2B"],
    }


@router.post("/run")
def run_reconciliation(
    payload: RunRequest,
    membership: OrganizationMember = Depends(get_entitled_membership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org_id = membership.organization_id
    gst_period = db.query(GstPeriod).filter_by(
        organization_id=org_id, return_period=payload.period
    ).first()
    if not gst_period:
        raise HTTPException(404, "GST period not found. Import both workbooks first.")
    purchase_batch = db.query(UploadBatch).filter_by(
        id=payload.purchase_batch_id, organization_id=org_id,
        gst_period_id=gst_period.id, source_type="PURCHASE_REGISTER", status="IMPORTED"
    ).first()
    portal_batch = db.query(UploadBatch).filter_by(
        id=payload.gstr2b_batch_id, organization_id=org_id,
        gst_period_id=gst_period.id, source_type="GSTR2B", status="IMPORTED"
    ).first()
    if not purchase_batch or not portal_batch:
        raise HTTPException(400, "Select valid imported Books and GSTR-2B batches for the same period.")

    books = db.query(PurchaseRegisterRecord).filter_by(
        organization_id=org_id, gst_period_id=gst_period.id, upload_batch_id=purchase_batch.id
    ).all()
    portals = db.query(Gstr2BRecord).filter_by(
        organization_id=org_id, gst_period_id=gst_period.id, upload_batch_id=portal_batch.id
    ).all()
    if not books or not portals:
        raise HTTPException(422, "Both selected batches must contain imported records.")

    run = ReconciliationRun(
        organization_id=org_id, gst_period_id=gst_period.id,
        purchase_upload_batch_id=purchase_batch.id, gstr2b_upload_batch_id=portal_batch.id,
        initiated_by=current_user.id, status="PROCESSING",
        tolerance_amount=payload.tolerance_amount,
        total_books_records=len(books), total_portal_records=len(portals),
    )
    try:
        db.add(run); db.flush()
        rows = build_results(books, portals, run.id, org_id, payload.tolerance_amount)
        db.add_all(rows)
        run.summary = summarize(rows)
        run.status = "COMPLETED"
        run.completed_at = datetime.utcnow()
        db.commit()
        return {"run_id": run.id, "status": run.status, "period": payload.period,
                "total_books_records": len(books), "total_portal_records": len(portals),
                "tolerance_amount": str(payload.tolerance_amount), "summary": run.summary}
    except Exception:
        db.rollback()
        raise


@router.get("/runs")
def list_runs(
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db),
):
    runs = db.query(ReconciliationRun).filter_by(
        organization_id=membership.organization_id
    ).order_by(ReconciliationRun.created_at.desc()).limit(50).all()
    return [{
        "id": r.id, "period": db.query(GstPeriod.return_period).filter_by(id=r.gst_period_id).scalar(),
        "status": r.status, "created_at": r.created_at.isoformat() if r.created_at else None,
        "summary": r.summary or {}, "total_books_records": r.total_books_records,
        "total_portal_records": r.total_portal_records,
    } for r in runs]


@router.get("/runs/{run_id}/results")
def get_run_results(
    run_id: int,
    status: Optional[str] = None,
    search: Optional[str] = None,
    offset: int = 0,
    limit: int = Query(100, ge=1, le=500),
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db),
):
    run = db.query(ReconciliationRun).filter_by(
        id=run_id, organization_id=membership.organization_id
    ).first()
    if not run: raise HTTPException(404, "Reconciliation run not found")
    q = db.query(ReconciliationResult).outerjoin(
        PurchaseRegisterRecord, ReconciliationResult.purchase_record_id == PurchaseRegisterRecord.id
    ).outerjoin(
        Gstr2BRecord, ReconciliationResult.gstr2b_record_id == Gstr2BRecord.id
    ).filter(
        ReconciliationResult.reconciliation_run_id == run_id,
        ReconciliationResult.organization_id == membership.organization_id,
    )
    if status:
        q = q.filter(ReconciliationResult.status == status)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(or_(
            PurchaseRegisterRecord.supplier_gstin.ilike(term),
            Gstr2BRecord.supplier_gstin.ilike(term),
            PurchaseRegisterRecord.invoice_number_original.ilike(term),
            Gstr2BRecord.invoice_number_original.ilike(term),
        ))
    total = q.count()
    rows = q.order_by(ReconciliationResult.id.asc()).offset(offset).limit(limit).all()
    # Bulk-load source rows for a compact, predictable response.
    book_ids = [r.purchase_record_id for r in rows if r.purchase_record_id]
    portal_ids = [r.gstr2b_record_id for r in rows if r.gstr2b_record_id]
    bmap = {x.id:x for x in db.query(PurchaseRegisterRecord).filter(PurchaseRegisterRecord.id.in_(book_ids)).all()} if book_ids else {}
    pmap = {x.id:x for x in db.query(Gstr2BRecord).filter(Gstr2BRecord.id.in_(portal_ids)).all()} if portal_ids else {}
    def val(x): return str(x) if x is not None else None
    output = []
    for r in rows:
        b, p = bmap.get(r.purchase_record_id), pmap.get(r.gstr2b_record_id)
        inv = b or p
        output.append({
            "id": r.id, "status": r.status, "gstin": inv.supplier_gstin if inv else "",
            "books_invoice": b.invoice_number_original if b else None,
            "portal_invoice": p.invoice_number_original if p else None,
            "books_date": b.invoice_date.isoformat() if b and b.invoice_date else None,
            "portal_date": p.invoice_date.isoformat() if p and p.invoice_date else None,
            "books_taxable": val(b.taxable_value) if b else None,
            "portal_taxable": val(p.taxable_value) if p else None,
            "taxable_difference": val(r.taxable_difference),
            "books_igst": val(b.igst) if b else None, "portal_igst": val(p.igst) if p else None,
            "igst_difference": val(r.igst_difference),
            "books_cgst": val(b.cgst) if b else None, "portal_cgst": val(p.cgst) if p else None,
            "cgst_difference": val(r.cgst_difference),
            "books_sgst": val(b.sgst) if b else None, "portal_sgst": val(p.sgst) if p else None,
            "sgst_difference": val(r.sgst_difference),
            "books_cess": val(b.cess) if b else None, "portal_cess": val(p.cess) if p else None,
            "cess_difference": val(r.cess_difference), "notes": r.review_notes,
        })
    return {"run_id": run_id, "summary": run.summary or {}, "total": total,
            "offset": offset, "limit": limit, "results": output}


@router.get("/runs/{run_id}/export")
def export_run(
    run_id: int,
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db),
):
    run = db.query(ReconciliationRun).filter_by(
        id=run_id, organization_id=membership.organization_id
    ).first()
    if not run: raise HTTPException(404, "Reconciliation run not found")
    # Export all results using the same response-building logic and source records.
    results = db.query(ReconciliationResult).filter_by(
        reconciliation_run_id=run_id, organization_id=membership.organization_id
    ).order_by(ReconciliationResult.id.asc()).all()
    book_ids = [r.purchase_record_id for r in results if r.purchase_record_id]
    portal_ids = [r.gstr2b_record_id for r in results if r.gstr2b_record_id]
    bmap = {x.id:x for x in db.query(PurchaseRegisterRecord).filter(PurchaseRegisterRecord.id.in_(book_ids)).all()} if book_ids else {}
    pmap = {x.id:x for x in db.query(Gstr2BRecord).filter(Gstr2BRecord.id.in_(portal_ids)).all()} if portal_ids else {}
    import pandas as pd
    data = []
    for r in results:
        b, p = bmap.get(r.purchase_record_id), pmap.get(r.gstr2b_record_id)
        inv = b or p
        data.append({
            "Status": r.status, "Supplier GSTIN": inv.supplier_gstin if inv else "",
            "Books Invoice": b.invoice_number_original if b else "",
            "Portal Invoice": p.invoice_number_original if p else "",
            "Books Date": b.invoice_date if b else None, "Portal Date": p.invoice_date if p else None,
            "Books Taxable": b.taxable_value if b else None, "Portal Taxable": p.taxable_value if p else None,
            "Taxable Difference (Books - Portal)": r.taxable_difference,
            "Books IGST": b.igst if b else None, "Portal IGST": p.igst if p else None, "IGST Difference": r.igst_difference,
            "Books CGST": b.cgst if b else None, "Portal CGST": p.cgst if p else None, "CGST Difference": r.cgst_difference,
            "Books SGST": b.sgst if b else None, "Portal SGST": p.sgst if p else None, "SGST Difference": r.sgst_difference,
            "Books Cess": b.cess if b else None, "Portal Cess": p.cess if p else None, "Cess Difference": r.cess_difference,
            "Review Notes": r.review_notes or "",
        })
    df = pd.DataFrame(data)
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Reconciliation")
        pd.DataFrame([run.summary or {}]).to_excel(writer, index=False, sheet_name="Summary")
    output.seek(0)
    filename = f"GST_Reconciliation_Run_{run_id}.xlsx"
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})
