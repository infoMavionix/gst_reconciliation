
import { useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, FormControl,
  Grid, InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography, Divider, TablePagination
} from "@mui/material";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import api from "../api/client";

type Batch = { id: number; filename: string; records: number; created_at: string | null };
type Options = { period: string; purchase_batches: Batch[]; gstr2b_batches: Batch[] };
type RunSummary = {
  total_results: number; matched: number; missing_in_portal: number; missing_in_books: number;
  taxable_mismatch: number; tax_mismatch: number; taxable_and_tax_mismatch: number;
  date_mismatch: number; duplicates: number; status_counts?: Record<string, number>;
};
type RunItem = { id: number; period: string; status: string; created_at: string | null; summary: RunSummary };
type ResultRow = {
  id: number; status: string; gstin: string; books_invoice: string | null; portal_invoice: string | null;
  books_date: string | null; portal_date: string | null; books_taxable: string | null; portal_taxable: string | null;
  taxable_difference: string | null; books_igst: string | null; portal_igst: string | null; igst_difference: string | null;
  books_cgst: string | null; portal_cgst: string | null; cgst_difference: string | null;
  books_sgst: string | null; portal_sgst: string | null; sgst_difference: string | null; notes: string | null;
};
const money = (v: string | null) => v == null ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const statusColor = (s: string): "success" | "warning" | "error" | "info" | "default" => {
  if (s === "MATCHED") return "success";
  if (s.startsWith("MISSING")) return "error";
  if (s.startsWith("DUPLICATE")) return "warning";
  return "info";
};

export default function ReconciliationPage() {
  const [period, setPeriod] = useState("072026");
  const [options, setOptions] = useState<Options | null>(null);
  const [bookBatch, setBookBatch] = useState("");
  const [portalBatch, setPortalBatch] = useState("");
  const [tolerance, setTolerance] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeRun, setActiveRun] = useState<number | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [runs, setRuns] = useState<RunItem[]>([]);

  const loadOptions = async () => {
    setLoadingOptions(true); setError("");
    try {
      const { data } = await api.get<Options>("/reconciliation/options", { params: { period } });
      setOptions(data);
      setBookBatch(data.purchase_batches[0] ? String(data.purchase_batches[0].id) : "");
      setPortalBatch(data.gstr2b_batches[0] ? String(data.gstr2b_batches[0].id) : "");
    } catch (e: any) { setError(e.response?.data?.detail || "Unable to load imported batches."); }
    finally { setLoadingOptions(false); }
  };
  const loadRuns = async () => {
    try { const { data } = await api.get<RunItem[]>("/reconciliation/runs"); setRuns(data); }
    catch { /* run history is optional until first reconciliation */ }
  };
  useEffect(() => { loadOptions(); loadRuns(); }, []);

  const runNow = async () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      const { data } = await api.post("/reconciliation/run", {
        period, purchase_batch_id: Number(bookBatch), gstr2b_batch_id: Number(portalBatch),
        tolerance_amount: Number(tolerance)
      }, { timeout: 120000 });
      setActiveRun(data.run_id); setSummary(data.summary); setFilter("ALL"); setSearch(""); setPage(0);
      await loadResults(data.run_id, "ALL", "", 0);
      await loadRuns();
      setNotice(`Reconciliation completed. ${data.summary.total_results} result rows created.`);
    } catch (e: any) { setError(e.response?.data?.detail || "Reconciliation failed."); }
    finally { setBusy(false); }
  };
  const loadResults = async (runId: number, status: string, term: string, pageIndex = 0, pageSize = rowsPerPage) => {
    const params: any = { limit: pageSize, offset: pageIndex * pageSize };
    if (status !== "ALL") params.status = status;
    if (term.trim()) params.search = term.trim();
    const { data } = await api.get(`/reconciliation/runs/${runId}/results`, { params });
    setRows(data.results); setSummary(data.summary); setTotal(data.total); setPage(pageIndex);
  };
  const chooseRun = async (id: number) => {
    setError(""); setNotice(""); setActiveRun(id); setFilter("ALL"); setSearch(""); setPage(0);
    try { await loadResults(id, "ALL", "", 0); }
    catch (e: any) { setError(e.response?.data?.detail || "Unable to load reconciliation results."); }
  };
  const applyFilter = async (next: string) => {
    setFilter(next); setPage(0);
    if (activeRun) try { await loadResults(activeRun, next, search, 0); } catch { /* retain visible rows */ }
  };
  const doSearch = async () => {
    if (activeRun) try { await loadResults(activeRun, filter, search, 0); } catch (e: any) { setError(e.response?.data?.detail || "Search failed."); }
  };
  const exportExcel = async () => {
    if (!activeRun) return;
    try {
      const response = await api.get(`/reconciliation/runs/${activeRun}/export`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a"); a.href = url; a.download = `GST_Reconciliation_Run_${activeRun}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setError("Excel export failed. Please try again."); }
  };
  const statCards = useMemo(() => summary ? [
    ["Matched", summary.matched, "success"], ["Missing in Portal", summary.missing_in_portal, "error"],
    ["Missing in Books", summary.missing_in_books, "error"], ["Taxable mismatch", summary.taxable_mismatch, "warning"],
    ["Tax mismatch", summary.tax_mismatch, "warning"], ["Tax + taxable mismatch", summary.taxable_and_tax_mismatch, "warning"],
    ["Date mismatch", summary.date_mismatch, "info"], ["Duplicate groups / rows", summary.duplicates, "warning"],
  ] as const : [], [summary]);

  return <Box sx={{ maxWidth: 1400, mx: "auto" }}>
    <Typography className="eyebrow">WORKSPACE</Typography>
    <Typography variant="h4" fontWeight={800} sx={{ mt: .5, mb: 1 }}>GST reconciliation</Typography>
    <Typography color="text.secondary" sx={{ mb: 3 }}>Compare your Books purchase register against GSTR-2B, review exceptions and export the results.</Typography>

    <Card variant="outlined" sx={{ borderRadius: 3, mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6" fontWeight={750} sx={{ mb: 2 }}>Configure reconciliation</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <TextField fullWidth label="Period (MMYYYY)" value={period} onChange={e => setPeriod(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <TextField fullWidth label="Tolerance (₹)" type="number" inputProps={{ min: 0, step: "0.01" }} value={tolerance} onChange={e => setTolerance(e.target.value)} helperText="Default ₹1.00" />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <FormControl fullWidth>
              <InputLabel>Books batch</InputLabel>
              <Select label="Books batch" value={bookBatch} onChange={e => setBookBatch(e.target.value)}>
                {(options?.purchase_batches || []).map(b => <MenuItem key={b.id} value={String(b.id)}>{b.filename} ({b.records})</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <FormControl fullWidth>
              <InputLabel>GSTR-2B batch</InputLabel>
              <Select label="GSTR-2B batch" value={portalBatch} onChange={e => setPortalBatch(e.target.value)}>
                {(options?.gstr2b_batches || []).map(b => <MenuItem key={b.id} value={String(b.id)}>{b.filename} ({b.records})</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button variant="outlined" startIcon={<RefreshRounded />} onClick={loadOptions} disabled={loadingOptions}>{loadingOptions ? "Loading…" : "Refresh batches"}</Button>
              <Button variant="contained" startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <PlayArrowRounded />} onClick={runNow} disabled={busy || !bookBatch || !portalBatch || !/^(0[1-9]|1[0-2])\d{4}$/.test(period) || Number(tolerance) < 0}>
                {busy ? "Reconciling…" : "Run reconciliation"}
              </Button>
            </Stack>
          </Grid>
        </Grid>
        {options && (!options.purchase_batches.length || !options.gstr2b_batches.length) &&
          <Alert severity="warning" sx={{ mt: 2 }}>Import one Books batch and one GSTR-2B batch for this period before running reconciliation.</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mt: 2 }}>{notice}</Alert>}
      </CardContent>
    </Card>

    {statCards.length > 0 && <Grid container spacing={1.5} sx={{ mb: 3 }}>
      {statCards.map(([label, value, color]) => <Grid size={{ xs: 6, sm: 4, md: 3 }} key={label}>
        <Card variant="outlined" sx={{ borderRadius: 2, height: "100%" }}><CardContent sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Typography variant="h4" fontWeight={800}>{value ?? 0}</Typography>
        </CardContent></Card>
      </Grid>)}
    </Grid>}

    <Card variant="outlined" sx={{ borderRadius: 3, mb: 3 }}>
      <CardContent>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={1} sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={750}>Reconciliation results</Typography>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Search GSTIN / invoice" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") doSearch(); }} />
            <Button variant="outlined" onClick={doSearch}>Search</Button>
            <Button variant="contained" startIcon={<DownloadRounded />} onClick={exportExcel} disabled={!activeRun}>Export Excel</Button>
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
          <Chip label="All" color={filter === "ALL" ? "primary" : "default"} onClick={() => applyFilter("ALL")} />
          {["MATCHED","MISSING_IN_PORTAL","MISSING_IN_BOOKS","TAXABLE_MISMATCH","TAX_MISMATCH","TAXABLE_AND_TAX_MISMATCH","DATE_MISMATCH","DUPLICATE_IN_BOOKS","DUPLICATE_IN_PORTAL","DUPLICATE_BOTH"].map(s =>
            <Chip key={s} label={s.replaceAll("_", " ")} color={filter === s ? "primary" : "default"} variant={filter === s ? "filled" : "outlined"} onClick={() => applyFilter(s)} />
          )}
        </Stack>
        {!activeRun ? <Alert severity="info">Choose the imported July 2026 batches and run reconciliation to see invoice-level results.</Alert> :
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow>
                <TableCell>Status</TableCell><TableCell>Supplier GSTIN</TableCell><TableCell>Books invoice</TableCell><TableCell>Portal invoice</TableCell>
                <TableCell align="right">Books taxable</TableCell><TableCell align="right">Portal taxable</TableCell><TableCell align="right">Difference</TableCell>
                <TableCell align="right">IGST Δ</TableCell><TableCell align="right">CGST Δ</TableCell><TableCell align="right">SGST Δ</TableCell><TableCell>Review notes</TableCell>
              </TableRow></TableHead>
              <TableBody>{rows.map(r => <TableRow key={r.id} hover>
                <TableCell><Chip size="small" color={statusColor(r.status)} label={r.status.replaceAll("_", " ")} /></TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{r.gstin}</TableCell><TableCell>{r.books_invoice || "—"}</TableCell><TableCell>{r.portal_invoice || "—"}</TableCell>
                <TableCell align="right">{money(r.books_taxable)}</TableCell><TableCell align="right">{money(r.portal_taxable)}</TableCell>
                <TableCell align="right">{money(r.taxable_difference)}</TableCell><TableCell align="right">{money(r.igst_difference)}</TableCell>
                <TableCell align="right">{money(r.cgst_difference)}</TableCell><TableCell align="right">{money(r.sgst_difference)}</TableCell>
                <TableCell sx={{ minWidth: 220 }}>{r.notes || "—"}</TableCell>
              </TableRow>)}
              {!rows.length && <TableRow><TableCell colSpan={11} align="center">No results for this filter.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>}
        {activeRun && <TablePagination component="div" count={total} page={page}
          onPageChange={(_, nextPage) => loadResults(activeRun, filter, search, nextPage)}
          rowsPerPage={rowsPerPage} rowsPerPageOptions={[25, 50, 100]}
          onRowsPerPageChange={e => { const size = Number(e.target.value); setRowsPerPage(size); loadResults(activeRun, filter, search, 0, size); }} />}
      </CardContent>
    </Card>

    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Typography variant="h6" fontWeight={750} sx={{ mb: 1 }}>Previous reconciliation runs</Typography>
        {!runs.length ? <Typography color="text.secondary">No reconciliation runs yet.</Typography> : runs.map(r =>
          <Box key={r.id} sx={{ py: 1.3 }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
              <Box><Typography fontWeight={700}>Run #{r.id} · {r.period}</Typography><Typography variant="caption" color="text.secondary">{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</Typography></Box>
              <Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={r.status} color={r.status === "COMPLETED" ? "success" : "default"} /><Button size="small" onClick={() => chooseRun(r.id)}>View results</Button></Stack>
            </Stack>
            <Divider sx={{ mt: 1 }} />
          </Box>)}
      </CardContent>
    </Card>
  </Box>;
}
