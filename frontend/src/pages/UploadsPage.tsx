
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Grid, MenuItem,
  Stack, TextField, Typography, Table, TableBody, TableCell, TableHead, TableRow
} from "@mui/material";
import CloudUploadRounded from "@mui/icons-material/CloudUploadRounded";
import api from "../api/client";

type UploadResult = {
  message: string; batch_id: number; source_type: string; period: string;
  imported_rows: number; skipped_invalid_rows: number;
  excluded_outside_period_rows: number; filename: string;
};
type HistoryItem = {
  id: number; source_type: string; filename: string; status: string;
  total_rows: number; created_at: string | null; period: number | null;
};
export default function UploadsPage() {
  const [source, setSource] = useState("PURCHASE_REGISTER");
  const [period, setPeriod] = useState("072026");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");

  const loadHistory = () => api.get("/uploads/history")
    .then(r => { setHistory(r.data); setHistoryError(""); })
    .catch(() => setHistoryError("Upload history is unavailable. Check that the backend is running."));
  useEffect(() => { loadHistory(); }, []);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] || null); setResult(null); setError("");
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(""); setResult(null);
    if (!file) { setError("Please select an Excel workbook."); return; }
    if (!/^(0[1-9]|1[0-2])\d{4}$/.test(period)) { setError("Enter period as MMYYYY, for example 072026."); return; }
    const data = new FormData();
    data.append("source_type", source); data.append("period", period); data.append("file", file);
    setBusy(true);
    try {
      const response = await api.post<UploadResult>("/uploads/import", data, {
        headers: { "Content-Type": "multipart/form-data" }, timeout: 120000
      });
      setResult(response.data); setFile(null);
      const input = document.getElementById("gst-workbook") as HTMLInputElement | null;
      if (input) input.value = "";
      loadHistory();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Upload failed. Please check the workbook and try again.");
    } finally { setBusy(false); }
  };

  return <Box sx={{ maxWidth: 1100, mx: "auto" }}>
    <Typography className="eyebrow">WORKSPACE</Typography>
    <Typography variant="h4" fontWeight={800} sx={{ mt: .5, mb: 1 }}>File uploads</Typography>
    <Typography color="text.secondary" sx={{ mb: 3 }}>Import your purchase register and GST portal GSTR-2B workbook for the same tax period.</Typography>

    <Card variant="outlined" sx={{ borderRadius: 3, mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <CloudUploadRounded color="primary" />
          <Typography variant="h6" fontWeight={750}>Import GST workbook</Typography>
        </Stack>
        <Box component="form" onSubmit={submit}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField select fullWidth label="File source" value={source} onChange={e => {setSource(e.target.value); setFile(null); setResult(null);}}>
                <MenuItem value="PURCHASE_REGISTER">Books – Purchase Register</MenuItem>
                <MenuItem value="GSTR2B">GST Portal – GSTR-2B</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="GST return period (MMYYYY)" value={period} onChange={e => setPeriod(e.target.value)} helperText="Example: July 2026 = 072026" />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Button component="label" variant="outlined" fullWidth sx={{ py: 2, borderStyle: "dashed", textTransform: "none" }}>
                <Stack alignItems="center" spacing={.5}>
                  <CloudUploadRounded />
                  <Typography fontWeight={700}>{file ? file.name : "Choose Excel workbook (.xlsx)"}</Typography>
                  <Typography variant="caption" color="text.secondary">Maximum file size: 20 MB</Typography>
                </Stack>
                <input id="gst-workbook" hidden type="file" accept=".xlsx,.xlsm" onChange={onFile} />
              </Button>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Alert severity="info">
                {source === "PURCHASE_REGISTER"
                  ? "Books format: supports separate CGST/SGST and IGST ledger sheets, as in your July 2026 sample."
                  : "Portal format: supports the GSTR-2B B2B sheet with supplier GSTIN, invoice details and tax columns."}
              </Alert>
            </Grid>
            {error && <Grid size={{ xs: 12 }}><Alert severity="error">{error}</Alert></Grid>}
            {result && <Grid size={{ xs: 12 }}>
              <Alert severity="success">
                <Typography fontWeight={700}>{result.message}</Typography>
                Imported {result.imported_rows} records. Skipped invalid rows: {result.skipped_invalid_rows}. Excluded outside period: {result.excluded_outside_period_rows}.
              </Alert>
            </Grid>}
            <Grid size={{ xs: 12 }}>
              <Button type="submit" variant="contained" disabled={busy || !file} sx={{ minWidth: 180, py: 1.2 }}>
                {busy ? <><CircularProgress size={18} sx={{ mr: 1, color: "inherit" }} /> Importing…</> : "Validate & import"}
              </Button>
            </Grid>
          </Grid>
        </Box>
      </CardContent>
    </Card>

    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={750}>Recent imports</Typography>
          <Button size="small" onClick={loadHistory}>Refresh</Button>
        </Stack>
        {historyError && <Alert severity="warning">{historyError}</Alert>}
        {!history.length ? <Typography color="text.secondary" py={2}>No imports yet. Upload your first workbook above.</Typography> :
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>File</TableCell><TableCell>Source</TableCell><TableCell align="right">Records</TableCell><TableCell>Status</TableCell><TableCell>Uploaded</TableCell></TableRow></TableHead>
              <TableBody>{history.map(item => <TableRow key={item.id}>
                <TableCell sx={{ minWidth: 220 }}>{item.filename}</TableCell>
                <TableCell>{item.source_type === "GSTR2B" ? "GST Portal" : "Books"}</TableCell>
                <TableCell align="right">{item.total_rows}</TableCell>
                <TableCell><Chip size="small" label={item.status} color={item.status === "IMPORTED" ? "success" : "default"} /></TableCell>
                <TableCell>{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </Box>}
      </CardContent>
    </Card>
  </Box>;
}
