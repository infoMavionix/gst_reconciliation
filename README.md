# GST Reconciliation SaaS — Phase 1

Multi-tenant foundation using React + Vite + TypeScript, FastAPI, SQLAlchemy 2, Alembic and MySQL 8.

## Phase 1 scope
- User registration creates the first organization and an OWNER membership.
- JWT login and `/auth/me`.
- Organization listing and organization creation.
- Organization membership and role-aware tenant access foundation.
- Core GST domain database models for vendors, GST periods, upload batches, purchase register, GSTR-2B records, reconciliation runs/results and audit logs.
- React login/register screens and authenticated dashboard shell.
- Local Docker Compose for MySQL and FastAPI.

Phase 1 does **not** yet implement file parsing, reconciliation, GST Portal connectivity, ITC eligibility decisions, billing, email delivery or production-grade account recovery.

## Architecture
- `frontend/`: React SPA. All protected screens call the API with a bearer token.
- `backend/`: FastAPI REST API, SQLAlchemy models, Pydantic schemas and tenant-scoped services.
- MySQL: persistent relational data. All tenant-owned tables include `organization_id`.
- Future processing: add background workers and private S3 storage for uploaded source files in Phase 2.

## Prerequisites
- Python 3.11+
- Node.js 20+
- Docker Desktop / Docker Engine (recommended for local MySQL)

## 1. Start MySQL
From the project root:

```bash
docker compose up -d mysql
```

## 2. Start backend
```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env
# macOS/Linux: cp .env.example .env
```

Edit `backend/.env` and set a long random `SECRET_KEY`. Set `DATABASE_URL` to your local MySQL credentials. Then:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: http://127.0.0.1:8000/docs

For the first local run, `AUTO_CREATE_TABLES=true` creates missing tables from SQLAlchemy metadata. This is a development convenience only. For shared/staging/production environments use Alembic migrations and set `AUTO_CREATE_TABLES=false`.

## 3. Start frontend
```bash
cd frontend
npm install
copy .env.example .env
# macOS/Linux: cp .env.example .env
npm run dev
```
Frontend: http://localhost:5173

## First use
1. Open the frontend and choose **Create account**.
2. Registration creates an organization and assigns the account the `OWNER` role.
3. Sign in and view the authenticated dashboard shell.
4. API requests use the JWT bearer token.

## Environment variables
See `backend/.env.example` and `frontend/.env.example`. Never commit `.env` files or production secrets.

## API endpoints in Phase 1
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Liveness |
| POST | `/api/v1/auth/register` | Create user + organization |
| POST | `/api/v1/auth/login` | Obtain JWT |
| GET | `/api/v1/auth/me` | Current user and memberships |
| GET | `/api/v1/organizations` | List accessible organizations |
| POST | `/api/v1/organizations` | Create organization |

## Database entities
- `users`
- `organizations`
- `organization_members`
- `vendors`
- `gst_periods`
- `upload_batches`
- `purchase_register`
- `gstr2b_records`
- `reconciliation_runs`
- `reconciliation_results`
- `audit_logs`

See `backend/app/models/models.py` for the authoritative SQLAlchemy schema.

## Security and production checklist
Before production:
- Use HTTPS only and secure cookies or short-lived access tokens plus refresh-token rotation.
- Store secrets in AWS Secrets Manager or SSM Parameter Store.
- Use RDS MySQL with private networking, backups and least-privilege credentials.
- Use private S3 buckets, encryption, malware/file validation and presigned upload/download flows.
- Add email verification, password reset, MFA and rate limiting.
- Add tenant-isolation tests for every endpoint and background job.
- Use Alembic migrations; do not use `create_all` in production.
- Add structured logs, metrics, alerts, audit retention and restore testing.
- Have a GST/accounting professional validate tax rules and report wording. The software must not independently determine legal ITC eligibility.

## Suggested next phases
- Phase 2: vendor management, GST period management, secure Excel/JSON upload and import validation.
- Phase 3: deterministic reconciliation engine, configurable tolerance, duplicate detection and manual review.
- Phase 4: dashboard metrics and Excel/CSV reports.
- Phase 5: S3, background jobs, email notifications, subscriptions and AWS production deployment.


## Billing and 60-day trial (added)
- New organizations receive a 60-day trial at registration.
- Plans are seeded by the billing API with indicative monthly prices: Starter ₹999, Growth ₹2,499 and Business ₹4,999. Edit `DEFAULT_PLANS` in `backend/app/api/routes/billing.py` before launch.
- Razorpay Standard Checkout accepts the payment methods enabled for your Razorpay account (for example UPI, cards and netbanking; availability is account/configuration dependent).
- Current implementation uses one-time monthly payments with manual renewal. It does not create an automatic recurring mandate.
- Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `backend/.env`. Use test keys first.
- Configure a Razorpay webhook to `POST https://YOUR_API_DOMAIN/api/v1/billing/webhook` and subscribe to `payment.captured`.
- Payment verification checks the Checkout signature and fetches the payment from Razorpay before activating paid access. The webhook is signature-verified and idempotent for already-paid records.
- For local testing, expose the API using a secure webhook tunnel and configure that public URL in the Razorpay Dashboard.
- Database tables added: `subscription_plans`, `organization_subscriptions`, `payments`.
- If you already created your database before this update, apply an Alembic migration or recreate the local development database. `AUTO_CREATE_TABLES=true` only creates missing tables; it does not alter existing tables.
- Before launch, finalize prices, tax treatment, cancellation/refund policy, terms, privacy policy, support contact and recurring-vs-manual renewal model.


Paid feature APIs should use `get_entitled_membership` from `app.api.deps`; billing endpoints use `get_current_membership` so expired customers can still view plans and pay. The frontend layout redirects expired users to `/billing`. Do not rely on frontend gating alone for any future business-data API.
