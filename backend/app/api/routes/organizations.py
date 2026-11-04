from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import Organization, OrganizationMember, User
from app.schemas.organization import OrganizationCreate, OrganizationResponse
from app.api.deps import get_current_user, get_entitled_membership

router = APIRouter(prefix="/organizations", tags=["Organizations"])

class OrganizationUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, max_length=250)
    gstin: str | None = Field(default=None, min_length=15, max_length=15)
    pan: str | None = Field(default=None, min_length=10, max_length=10)
    business_email: str | None = None

@router.get("", response_model=list[OrganizationResponse])
def list_organizations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Organization).join(OrganizationMember).filter(
        OrganizationMember.user_id == current_user.id,
        OrganizationMember.is_active.is_(True),
        Organization.is_active.is_(True),
    ).all()

@router.get("/current", response_model=OrganizationResponse)
def current_organization(
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db),
):
    organization = db.query(Organization).filter_by(id=membership.organization_id, is_active=True).first()
    if not organization:
        raise HTTPException(404, "Organization not found")
    return organization

@router.patch("/current", response_model=OrganizationResponse)
def update_current_organization(
    payload: OrganizationUpdate,
    membership: OrganizationMember = Depends(get_entitled_membership),
    db: Session = Depends(get_db),
):
    if membership.role.upper() not in ("OWNER", "ADMIN"):
        raise HTTPException(403, "Only an organization owner or admin can update organization settings")
    organization = db.query(Organization).filter_by(id=membership.organization_id, is_active=True).first()
    if not organization:
        raise HTTPException(404, "Organization not found")
    if payload.gstin:
        existing = db.query(Organization).filter(
            Organization.gstin == payload.gstin.upper(),
            Organization.id != organization.id,
            Organization.is_active.is_(True),
        ).first()
        if existing:
            raise HTTPException(409, "This GSTIN is already registered")
    organization.name = payload.name.strip()
    organization.legal_name = payload.legal_name.strip() if payload.legal_name else None
    organization.gstin = payload.gstin.upper() if payload.gstin else None
    organization.pan = payload.pan.upper() if payload.pan else None
    organization.business_email = payload.business_email.strip() if payload.business_email else None
    db.commit()
    db.refresh(organization)
    return organization

@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.gstin:
        existing = db.query(Organization).filter(
            Organization.gstin == payload.gstin.upper(), Organization.is_active.is_(True)
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="This GSTIN is already registered")
    organization = Organization(
        name=payload.name.strip(),
        legal_name=payload.legal_name,
        gstin=payload.gstin.upper() if payload.gstin else None,
        pan=payload.pan.upper() if payload.pan else None,
        business_email=payload.business_email,
    )
    db.add(organization)
    db.flush()
    db.add(OrganizationMember(organization_id=organization.id, user_id=current_user.id, role="OWNER"))
    db.commit()
    db.refresh(organization)
    return organization
