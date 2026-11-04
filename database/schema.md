# Database schema overview

All tenant-owned business data is scoped by `organization_id`.

## Identity and tenant tables
- `users`: account identity and password hash.
- `organizations`: customer company / tenant.
- `organization_members`: user-to-organization membership and role.

## GST domain tables
- `vendors`: supplier master scoped to organization.
- `gst_periods`: financial year and GST return period.
- `upload_batches`: uploaded source file metadata and processing state.
- `purchase_register`: normalized internal purchase invoice rows.
- `gstr2b_records`: normalized GSTR-2B invoice rows.
- `reconciliation_runs`: immutable run configuration and summary.
- `reconciliation_results`: row-level classification and differences.
- `audit_logs`: important user and system events.

## Billing tables
- `subscription_plans`: configurable plan catalog and price in paise.
- `organization_subscriptions`: one current trial/paid subscription per organization.
- `payments`: Razorpay order/payment references and verification state.

Amounts are stored as integer paise for billing and `NUMERIC(18,2)` for GST invoice values. Never use floating-point values for monetary calculations.
