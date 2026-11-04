import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
  Paper, Stack, Typography
} from "@mui/material";
import {
  ArrowForwardRounded, CloudUploadRounded, CompareArrowsRounded,
  StorefrontRounded, RefreshRounded, ReceiptLongRounded, CheckCircleRounded,
  WarningAmberRounded, AssessmentRounded
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import api from "../api/client";

type UploadBatch = {
  id: number;
  source_type: "PURCHASE_REGISTER" | "GSTR2B";
  filename: string;
  status: string;
  total_rows: number;
  created_at: string | null;
  period: number;
};

type RunSummary = {
  total_results?: number;
  matched?: number;
  missing_in_portal?: number;
  missing_in_books?: number;
  taxable_mismatch?: number;
  tax_mismatch?: number;
  taxable_and_tax_mismatch?: number;
  date_mismatch?: number;
  duplicates?: number;
};

type ReconciliationRun = {
  id: number;
  period: string;
  status: string;
  created_at: string | null;
  summary: RunSummary;
  total_books_records?: number;
  total_portal_records?: number;
};

type ResultRow = {
  books_igst: string | null;
  portal_igst: string | null;
  books_cgst: string | null;
  portal_cgst: string | null;
  books_sgst: string | null;
  portal_sgst: string | null;
  books_cess?: string | null;
  portal_cess?: string | null;
};

type ResultsPage = {
  total: number;
  results: ResultRow[];
};

type DashboardData = {
  uploads: UploadBatch[];
  runs: ReconciliationRun[];
  booksItc: number | null;
  portalItc: number | null;
};

const money = (value: number | null) =>
  value === null
    ? "—"
    : `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const number = (value: string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }) : "—";

const periodLabel = (period?: string) => {
  if (!period || !/^(0[1-9]|1[0-2])\d{4}$/.test(period)) return "Latest period";
  return new Date(Number(period.slice(2)), Number(period.slice(0, 2)) - 1, 1)
    .toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

async function getItcTotal(runId: number, side: "books" | "portal"): Promise<number> {
  const pageSize = 500;
  let offset = 0;
  let total = 0;
  let totalRows = 0;

  do {
    const { data } = await api.get<ResultsPage>(`/reconciliation/runs/${runId}/results`, {
      params: { limit: pageSize, offset },
      timeout: 60000
    });
    for (const row of data.results) {
      total += number(row[`${side}_igst` as keyof ResultRow] as string | null)
        + number(row[`${side}_cgst` as keyof ResultRow] as string | null)
        + number(row[`${side}_sgst` as keyof ResultRow] as string | null)
        + number(row[`${side}_cess` as keyof ResultRow] as string | null);
    }
    totalRows = data.total;
    offset += data.results.length;
    if (data.results.length === 0) break;
  } while (offset < totalRows);

  return total;
}

async function loadDashboardData(): Promise<DashboardData> {
  const [uploadsResponse, runsResponse] = await Promise.all([
    api.get<UploadBatch[]>("/uploads/history"),
    api.get<ReconciliationRun[]>("/reconciliation/runs")
  ]);

  const uploads = uploadsResponse.data || [];
  const runs = runsResponse.data || [];
  const latestCompletedRun = runs.find(run => run.status === "COMPLETED");

  let booksItc: number | null = null;
  let portalItc: number | null = null;
  if (latestCompletedRun) {
    const [books, portal] = await Promise.all([
      getItcTotal(latestCompletedRun.id, "books"),
      getItcTotal(latestCompletedRun.id, "portal")
    ]);
    booksItc = books;
    portalItc = portal;
  }

  return { uploads, runs, booksItc, portalItc };
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const org = user?.memberships[0];
  const [data, setData] = useState<DashboardData>({
    uploads: [], runs: [], booksItc: null, portalItc: null
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    setError("");
    try {
      const next = await loadDashboardData();
      setData(next);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Unable to load dashboard data. Please refresh.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(false); }, [refresh]);

  const latestRun = data.runs.find(run => run.status === "COMPLETED") || data.runs[0];
  const summary = latestRun?.summary || {};
  const booksBatch = data.uploads.find(batch => batch.source_type === "PURCHASE_REGISTER");
  const portalBatch = data.uploads.find(batch => batch.source_type === "GSTR2B");
  const needsReview = (summary.missing_in_portal || 0)
    + (summary.missing_in_books || 0)
    + (summary.taxable_mismatch || 0)
    + (summary.tax_mismatch || 0)
    + (summary.taxable_and_tax_mismatch || 0)
    + (summary.date_mismatch || 0)
    + (summary.duplicates || 0);

  const cards = useMemo(() => [
    {
      title: "Books ITC",
      value: money(data.booksItc),
      note: latestRun ? `Calculated from reconciliation run #${latestRun.id}` : "Available after reconciliation",
      color: "#2563eb",
      icon: <ReceiptLongRounded />
    },
    {
      title: "Portal ITC",
      value: money(data.portalItc),
      note: latestRun ? `Calculated from reconciliation run #${latestRun.id}` : "Available after reconciliation",
      color: "#0891b2",
      icon: <ReceiptLongRounded />
    },
    {
      title: "Matched invoices",
      value: latestRun ? String(summary.matched ?? 0) : "—",
      note: latestRun ? `Out of ${summary.total_results ?? 0} reconciliation results` : "No completed run yet",
      color: "#16a36a",
      icon: <CheckCircleRounded />
    },
    {
      title: "Needs review",
      value: latestRun ? String(needsReview) : "—",
      note: latestRun ? "Exceptions requiring attention" : "No completed run yet",
      color: "#d97706",
      icon: <WarningAmberRounded />
    }
  ], [data.booksItc, data.portalItc, latestRun, summary, needsReview]);

  const recentUploads = data.uploads.slice(0, 4);
  const recentRuns = data.runs.slice(0, 4);
  const totalUploads = data.uploads.length;

  return <Box sx={{ maxWidth: 1500, mx: "auto" }}>
    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={2} sx={{ mb: 3 }}>
      <Box>
        <Typography className="eyebrow">WORKSPACE OVERVIEW</Typography>
        <Typography variant="h4" fontWeight={800} sx={{ mt: .5 }}>
          Good to see you, {user?.full_name?.split(" ")[0] || "there"}.
        </Typography>
        <Typography color="text.secondary" fontSize={14} sx={{ mt: .5 }}>
          Live GST reconciliation status for {org?.name || "your organization"}.
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          size="small"
          color={latestRun ? "success" : totalUploads ? "info" : "default"}
          variant="outlined"
          label={latestRun ? `Latest: ${periodLabel(latestRun.period)}` : totalUploads ? "Imports available" : "Awaiting first import"}
        />
        <Button variant="outlined" startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshRounded />}
          onClick={() => void refresh()} disabled={refreshing}>
          Refresh
        </Button>
      </Stack>
    </Stack>

    {error && <Alert severity="error" sx={{ mb: 2 }} action={
      <Button color="inherit" size="small" onClick={() => void refresh()}>Retry</Button>
    }>{error}</Alert>}

    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }, gap: 2 }}>
      {cards.map(card => <Paper key={card.title} className="metric-card" elevation={0} sx={{ minWidth: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Box sx={{ width: 4, height: 30, bgcolor: card.color, borderRadius: 2 }} />
          <Box sx={{ color: card.color, display: "flex" }}>{card.icon}</Box>
        </Stack>
        <Typography color="text.secondary" fontSize={13}>{card.title}</Typography>
        <Typography variant="h4" fontWeight={800} sx={{ my: .5, overflowWrap: "anywhere" }}>
          {loading ? <CircularProgress size={22} /> : card.value}
        </Typography>
        <Typography color="text.secondary" fontSize={11}>{card.note}</Typography>
      </Paper>)}
    </Box>

    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.35fr) minmax(320px, .9fr)" }, gap: 2, mt: 2 }}>
      <Paper className="panel" elevation={0}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Box>
            <Typography fontWeight={800}>Reconciliation summary</Typography>
            <Typography color="text.secondary" fontSize={12}>
              {latestRun ? `Run #${latestRun.id} · ${periodLabel(latestRun.period)}` : "Your latest reconciliation activity"}
            </Typography>
          </Box>
          <Button size="small" endIcon={<ArrowForwardRounded />} onClick={() => navigate("/reconciliation")}>View</Button>
        </Stack>
        {loading ? <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={24} /></Box> :
          latestRun ? <>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5, mt: 2 }}>
              {[
                ["Total results", summary.total_results ?? 0],
                ["Matched", summary.matched ?? 0],
                ["Missing in Portal", summary.missing_in_portal ?? 0],
                ["Missing in Books", summary.missing_in_books ?? 0],
                ["Taxable mismatches", summary.taxable_mismatch ?? 0],
                ["Tax / date exceptions", (summary.tax_mismatch ?? 0) + (summary.taxable_and_tax_mismatch ?? 0) + (summary.date_mismatch ?? 0)],
              ].map(([label, value]) => <Box key={String(label)} sx={{ p: 1.5, bgcolor: "#f7f9fc", borderRadius: 2 }}>
                <Typography color="text.secondary" fontSize={11}>{label}</Typography>
                <Typography fontWeight={800} fontSize={21}>{value}</Typography>
              </Box>)}
            </Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
              <Typography color="text.secondary" fontSize={11}>Last completed {dateLabel(latestRun.created_at)}</Typography>
              <Chip size="small" color="success" label={latestRun.status} />
            </Stack>
          </> : <Alert severity="info" sx={{ mt: 2 }}>
            {totalUploads
              ? "Your files are imported. Run reconciliation to see matched invoices, ITC totals and exceptions here."
              : "Start by importing your Books purchase register and GSTR-2B workbook."}
          </Alert>}
      </Paper>

      <Paper className="panel" elevation={0}>
        <Typography fontWeight={800}>Quick actions</Typography>
        <Typography color="text.secondary" fontSize={12} sx={{ mt: .5, mb: 1 }}>Go directly to your main GST workflows.</Typography>
        {[
          [<CloudUploadRounded />, "File uploads", "Import Books or GSTR-2B", "/uploads"],
          [<CompareArrowsRounded />, "Reconciliation", "Compare invoices and review differences", "/reconciliation"],
          [<StorefrontRounded />, "Vendors", "View supplier information", "/vendors"],
          [<AssessmentRounded />, "Reports", "Open reconciliation reports", "/reports"],
        ].map(([icon, title, description, path]: any) =>
          <Box key={title} onClick={() => navigate(path)} className="quick-row"
            sx={{ cursor: "pointer", "&:hover": { bgcolor: "#f8faff" }, px: 1, mx: -1, borderRadius: 2 }}>
            <Box className="quick-icon">{icon}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontSize={13} fontWeight={700}>{title}</Typography>
              <Typography fontSize={11} color="text.secondary">{description}</Typography>
            </Box>
            <ArrowForwardRounded fontSize="small" color="action" />
          </Box>
        )}
      </Paper>
    </Box>

    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2, mt: 2 }}>
      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Box>
              <Typography fontWeight={800}>Recent file uploads</Typography>
              <Typography color="text.secondary" fontSize={12}>Latest imported workbooks</Typography>
            </Box>
            <Button size="small" onClick={() => navigate("/uploads")}>View all</Button>
          </Stack>
          {loading ? <CircularProgress size={22} /> : recentUploads.length ? recentUploads.map(batch =>
            <Box key={batch.id} sx={{ py: 1.3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={700} fontSize={13} noWrap>{batch.filename}</Typography>
                  <Typography color="text.secondary" fontSize={11}>
                    {batch.source_type === "GSTR2B" ? "GSTR-2B portal" : "Books purchase register"} · {batch.total_rows.toLocaleString("en-IN")} records
                  </Typography>
                  <Typography color="text.secondary" fontSize={10}>{dateLabel(batch.created_at)}</Typography>
                </Box>
                <Chip size="small" label={batch.status} color={batch.status === "IMPORTED" ? "success" : "default"} />
              </Stack>
              <Divider sx={{ mt: 1.2 }} />
            </Box>
          ) : <Typography color="text.secondary" fontSize={13} sx={{ py: 2 }}>No uploads found. Import your first workbook to get started.</Typography>}
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Box>
              <Typography fontWeight={800}>Recent reconciliation runs</Typography>
              <Typography color="text.secondary" fontSize={12}>Your latest comparison history</Typography>
            </Box>
            <Button size="small" onClick={() => navigate("/reconciliation")}>View all</Button>
          </Stack>
          {loading ? <CircularProgress size={22} /> : recentRuns.length ? recentRuns.map(run =>
            <Box key={run.id} sx={{ py: 1.3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Box>
                  <Typography fontWeight={700} fontSize={13}>Run #{run.id} · {periodLabel(run.period)}</Typography>
                  <Typography color="text.secondary" fontSize={11}>{dateLabel(run.created_at)}</Typography>
                  <Typography color="text.secondary" fontSize={11}>
                    {run.summary?.matched ?? 0} matched / {run.summary?.total_results ?? 0} results
                  </Typography>
                </Box>
                <Chip size="small" label={run.status} color={run.status === "COMPLETED" ? "success" : "default"} />
              </Stack>
              <Divider sx={{ mt: 1.2 }} />
            </Box>
          ) : <Typography color="text.secondary" fontSize={13} sx={{ py: 2 }}>No reconciliation runs yet.</Typography>}
        </CardContent>
      </Card>
    </Box>
  </Box>;
}
