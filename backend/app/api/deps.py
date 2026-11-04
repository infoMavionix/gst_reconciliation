from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.core.config import settings
from app.database import get_db
from app.models.models import User, OrganizationMember

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = int(payload.get("sub", ""))
    except (JWTError, ValueError, TypeError):
        raise credentials_error
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise credentials_error
    return user

def get_current_membership(
    organization_id: int = Header(..., alias="X-Organization-ID"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrganizationMember:
    membership = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == organization_id,
        OrganizationMember.user_id == current_user.id,
        OrganizationMember.is_active.is_(True),
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="You do not have access to this organization")
    return membership


def get_entitled_membership(
    membership: OrganizationMember = Depends(get_current_membership),
    db: Session = Depends(get_db),
) -> OrganizationMember:
    # Use this dependency on all paid product APIs (imports, vendors, reconciliation, reports).
    # Billing endpoints intentionally use get_current_membership so expired users can renew.
    from datetime import datetime
    from fastapi import HTTPException
    from app.models.models import OrganizationSubscription

    subscription = db.query(OrganizationSubscription).filter(
        OrganizationSubscription.organization_id == membership.organization_id
    ).first()
    if not subscription:
        raise HTTPException(status_code=402, detail="No subscription found. Open Plans & billing to continue.")
    now = datetime.utcnow()
    trial_valid = subscription.status == "TRIALING" and now < subscription.trial_ends_at
    paid_valid = (
        subscription.status == "ACTIVE"
        and subscription.current_period_end is not None
        and now < subscription.current_period_end
    )
    if not (trial_valid or paid_valid):
        raise HTTPException(status_code=402, detail="Your trial or subscription has expired. Choose a plan to continue.")
    return membership
