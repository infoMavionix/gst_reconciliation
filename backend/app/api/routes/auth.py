from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime, timedelta
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models.models import User, Organization, OrganizationMember, OrganizationSubscription, AuditLog
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse
from app.core.security import hash_password, verify_password, create_access_token
from app.core.config import settings
from app.api.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

def user_payload(user: User):
    memberships = []
    for membership in user.memberships:
        if membership.is_active and membership.organization.is_active:
            memberships.append({
                "id": membership.organization.id,
                "name": membership.organization.name,
                "gstin": membership.organization.gstin,
                "role": membership.role,
            })
    return {"id": user.id, "full_name": user.full_name, "email": user.email, "memberships": memberships}

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(full_name=payload.full_name.strip(), email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    organization = Organization(name=payload.organization_name.strip())
    db.add(organization)
    db.flush()
    db.add(OrganizationMember(user_id=user.id, organization_id=organization.id, role="OWNER"))
    trial_start = datetime.utcnow()
    trial_end = trial_start + timedelta(days=settings.TRIAL_DAYS)
    db.add(OrganizationSubscription(organization_id=organization.id, status="TRIALING", trial_starts_at=trial_start, trial_ends_at=trial_end))
    db.add(AuditLog(organization_id=organization.id, user_id=user.id, action="ORGANIZATION_REGISTERED", entity_type="organization", entity_id=str(organization.id), details={"trial_days": settings.TRIAL_DAYS}))
    db.commit()
    user = db.query(User).options(
        joinedload(User.memberships).joinedload(OrganizationMember.organization)
    ).filter(User.id == user.id).first()
    token = create_access_token(str(user.id))
    return TokenResponse(
        access_token=token,
        expires_in=30 * 60,
        user=user_payload(user),
    )

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).options(
        joinedload(User.memberships).joinedload(OrganizationMember.organization)
    ).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account is disabled")
    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token, expires_in=30 * 60, user=user_payload(user))

@router.get("/me")
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).options(
        joinedload(User.memberships).joinedload(OrganizationMember.organization)
    ).filter(User.id == current_user.id).first()
    return user_payload(user)
