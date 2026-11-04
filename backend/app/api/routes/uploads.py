
from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
import re
import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from app.api.deps import get_current_user, get_entitled_membership
from app.database import get_db
from app.models.models import GstPeriod, UploadBatch, PurchaseRegisterRecord, Gstr2BRecord, User, OrganizationMember

router = APIRouter(prefix="/uploads", tags=["uploads"])
ALLOWED = {".xlsx", ".xlsm"}

def norm_invoice(value) -> str:
    if value is None or pd.isna(value): return ""
    return re.sub(r"[^A-Z0-9]", "", str(value).strip().upper())

def as_decimal(value) -> Decimal:
    if value is None or pd.isna(value) or str(value).strip() == "": return Decimal("0.00")
    try: return Decimal(str(value).replace(",", "").strip()).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError): return Decimal("0.00")

def as_date(value):
    if value is None or pd.isna(value): return None
    try:
        d = pd.to_datetime(value, dayfirst=True, errors="coerce")
        if pd.isna(d): return None
        return d.date()
    except Exception:
        return None

def get_period(db: Session, org_id: int, period: str):
    if not re.fullmatch(r"\d{6}", period):
        raise HTTPException(400, "Period must be MMYYYY, for example 072026")
    month, year = int(period[:2]), int(period[2:])
    if month < 1 or month > 12: raise HTTPException(400, "Invalid GST month")
    import calendar
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    fy = f"{year if month >= 4 else year-1}-{str((year if month >= 4 else year-1)+1)[-2:]}"
    obj = db.query(GstPeriod).filter_by(organization_id=org_id, financial_year=fy, return_period=period).first()
    if not obj:
        obj = GstPeriod(organization_id=org_id, financial_year=fy, return_period=period, start_date=start, end_date=end)
        db.add(obj); db.flush()
    return obj

def clean_row(gstin, inv, invdate, taxable, igst=0, cgst=0, sgst=0, cess=0):
    gstin = "" if gstin is None or pd.isna(gstin) else re.sub(r"\s+", "", str(gstin).upper())
    inv_original = "" if inv is None or pd.isna(inv) else str(inv).strip()
    d = as_date(invdate)
    if len(gstin) != 15 or not inv_original or not d: return None
    return dict(gstin=gstin, inv=inv_original[:100], norm=norm_invoice(inv_original)[:100], date=d,
                taxable=as_decimal(taxable), igst=as_decimal(igst), cgst=as_decimal(cgst),
                sgst=as_decimal(sgst), cess=as_decimal(cess))

def parse_books(content: bytes, start: date, end: date):
    """
    Parse the two Tally ledgers in the supplied Books workbook.

    CGST sheet:
      G (index 6) = Gross Total
      H (index 7) = purchase ledger amount (taxable base when populated)
      I/J (indices 8/9) = CGST/SGST

    When the purchase-ledger amount in column H is blank, derive taxable
    value from Gross Total less the applicable tax components:
      CGST sheet: Gross Total - CGST - SGST
      IGST sheet: Gross Total - IGST
    Explicit ledger values always take priority.
    """
    xls = pd.ExcelFile(BytesIO(content))
    rows, skipped, outside = [], 0, 0

    for sheet in xls.sheet_names:
        raw = pd.read_excel(xls, sheet_name=sheet, header=None, dtype=object)
        if raw.empty:
            continue

        title = str(raw.iloc[3, 0]).lower() if len(raw) > 3 and pd.notna(raw.iloc[3, 0]) else sheet.lower()
        is_igst = "igst" in title or "igst" in sheet.lower()

        # Tally column headings are on zero-based row 7; transactions begin row 8.
        for idx in range(8, len(raw)):
            r = raw.iloc[idx].tolist()
            if len(r) < 9:
                continue

            invdate = r[4] if len(r) > 4 and pd.notna(r[4]) else r[0]
            gstin = r[5] if len(r) > 5 else None
            inv = r[3] if len(r) > 3 else None

            if is_igst:
                # Prefer the explicit taxable purchase-ledger value in column H.
                # In this workbook some IGST rows leave H blank; in those cases
                # derive taxable value from Gross Total (G) less IGST (I).
                gross_total = as_decimal(r[6] if len(r) > 6 else 0)
                ledger_taxable_raw = r[7] if len(r) > 7 else None
                igst = as_decimal(r[8] if len(r) > 8 else 0)
                if ledger_taxable_raw is not None and not pd.isna(ledger_taxable_raw) and str(ledger_taxable_raw).strip():
                    taxable = as_decimal(ledger_taxable_raw)
                else:
                    taxable = max(Decimal("0.00"), gross_total - igst)
                rec = clean_row(gstin, inv, invdate, taxable, igst=igst)
            else:
                gross_total = as_decimal(r[6] if len(r) > 6 else 0)
                ledger_taxable_raw = r[7] if len(r) > 7 else None
                cgst = as_decimal(r[8] if len(r) > 8 else 0)
                sgst = as_decimal(r[9] if len(r) > 9 else 0)

                # Prefer the explicit purchase ledger value. In this workbook
                # some rows leave that cell blank; their gross total includes
                # CGST + SGST, so derive the taxable base from the gross total.
                if ledger_taxable_raw is not None and not pd.isna(ledger_taxable_raw) and str(ledger_taxable_raw).strip():
                    taxable = as_decimal(ledger_taxable_raw)
                else:
                    taxable = max(Decimal("0.00"), gross_total - cgst - sgst)

                rec = clean_row(gstin, inv, invdate, taxable, cgst=cgst, sgst=sgst)

            if not rec:
                skipped += 1
                continue
            if not (start <= rec["date"] <= end):
                outside += 1
                continue
            rows.append((rec, idx + 1))

    return rows, skipped, outside

def parse_portal(content: bytes, start: date, end: date):
    raw = pd.read_excel(BytesIO(content), sheet_name="B2B", header=None, dtype=object)
    rows, skipped, outside = [], 0, 0
    # GST portal workbook: supplier GSTIN is row 6 col A; invoice subheaders row 7.
    for idx in range(6, len(raw)):
        r = raw.iloc[idx].tolist()
        if len(r) < 10: continue
        rec = clean_row(r[0], r[2], r[4], r[6], igst=r[7], cgst=r[8], sgst=r[9])
        if not rec: skipped += 1; continue
        if not (start <= rec["date"] <= end): outside += 1; continue
        rows.append((rec, idx+1))
    return rows, skipped, outside

@router.post("/import")
async def import_workbook(
    source_type: str = Form(...),
    period: str = Form(...),
    file: UploadFile = File(...),
    membership: OrganizationMember = Depends(get_entitled_membership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    source_type = source_type.upper().strip()
    if source_type not in ("PURCHASE_REGISTER", "GSTR2B"):
        raise HTTPException(400, "source_type must be PURCHASE_REGISTER or GSTR2B")
    name = file.filename or "upload.xlsx"
    ext = "." + name.rsplit(".",1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED: raise HTTPException(400, "Please upload an Excel .xlsx or .xlsm file")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024: raise HTTPException(413, "File exceeds 20 MB limit")
    try:
        gst_period = get_period(db, membership.organization_id, period)
        if source_type == "PURCHASE_REGISTER":
            parsed, skipped, outside = parse_books(content, gst_period.start_date, gst_period.end_date)
        else:
            parsed, skipped, outside = parse_portal(content, gst_period.start_date, gst_period.end_date)
    except HTTPException: raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(422, f"Could not read this workbook: {str(exc)[:240]}")
    if not parsed:
        raise HTTPException(422, f"No valid {source_type} rows found for {period}. Skipped invalid rows: {skipped}; outside period: {outside}.")
    batch = UploadBatch(
        organization_id=membership.organization_id, gst_period_id=gst_period.id,
        uploaded_by=current_user.id, source_type=source_type, original_filename=name,
        file_sha256=sha256(content).hexdigest(), status="IMPORTED",
        total_rows=len(parsed), error_summary={"skipped_invalid": skipped, "outside_period": outside}
    )
    db.add(batch); db.flush()
    Model = PurchaseRegisterRecord if source_type == "PURCHASE_REGISTER" else Gstr2BRecord
    for rec, source_row in parsed:
        db.add(Model(
            organization_id=membership.organization_id, upload_batch_id=batch.id,
            gst_period_id=gst_period.id, supplier_gstin=rec["gstin"],
            invoice_number_original=rec["inv"], invoice_number_normalized=rec["norm"],
            invoice_date=rec["date"], taxable_value=rec["taxable"], igst=rec["igst"],
            cgst=rec["cgst"], sgst=rec["sgst"], cess=rec["cess"], source_row_number=source_row
        ))
    db.commit()
    return {"message":"Workbook imported successfully","batch_id":batch.id,"source_type":source_type,
            "period":period,"imported_rows":len(parsed),"skipped_invalid_rows":skipped,
            "excluded_outside_period_rows":outside,"filename":name}

@router.get("/history")
def upload_history(
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db)
):
    batches = db.query(UploadBatch).filter_by(organization_id=membership.organization_id).order_by(UploadBatch.created_at.desc()).limit(50).all()
    return [{"id":b.id,"source_type":b.source_type,"filename":b.original_filename,"status":b.status,
             "total_rows":b.total_rows,"created_at":b.created_at.isoformat() if b.created_at else None,
             "period":b.gst_period_id,"errors":b.error_summary} for b in batches]
