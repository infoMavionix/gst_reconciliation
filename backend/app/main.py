from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.database import Base, engine
from app.models import models  # noqa: F401
from app.api.routes import auth, organizations, health, billing, uploads, reconciliation, vendors

if settings.AUTO_CREATE_TABLES and settings.ENVIRONMENT == "development":
    Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="Multi-tenant GST reconciliation platform API",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Organization-ID"],
)
app.include_router(health.router, prefix=settings.API_V1_PREFIX)
app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(organizations.router, prefix=settings.API_V1_PREFIX)
app.include_router(billing.router, prefix=settings.API_V1_PREFIX)
app.include_router(uploads.router, prefix=settings.API_V1_PREFIX)
app.include_router(reconciliation.router, prefix=settings.API_V1_PREFIX)
app.include_router(vendors.router, prefix=settings.API_V1_PREFIX)

@app.get("/")
def root():
    return {"message": "GST Reconciliation API", "docs": "/docs"}
