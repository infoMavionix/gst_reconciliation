import { useState, type FormEvent } from "react";
import { Alert, Box, Button, CircularProgress, TextField, Typography, Link as MuiLink } from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", password: "", organization_name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(v => ({ ...v, [key]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      if (isRegister) await register(form);
      else await login(form.email, form.password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Unable to complete your request. Please try again.");
    } finally { setBusy(false); }
  }

  return <Box className="auth-shell">
    <Box className="auth-art">
      <Box className="auth-art-content">
        <Box className="brand-mark brand-mark-large">G</Box>
        <Typography variant="h3" fontWeight={800} lineHeight={1.12} sx={{ mt: 4, maxWidth: 480 }}>Clarity in every tax record.</Typography>
        <Typography sx={{ mt: 2, color: "rgba(255,255,255,.72)", maxWidth: 430, lineHeight: 1.8 }}>Bring your purchase register and GST portal data together. Find differences, review exceptions and stay in control.</Typography>
        <Box className="auth-art-note"><Typography fontSize={12} color="rgba(255,255,255,.7)">BOOKS  ↔  GSTR-2B</Typography><Typography fontWeight={700}>A clearer way to reconcile.</Typography></Box>
      </Box>
    </Box>
    <Box className="auth-form-side">
      <Box className="auth-form">
        <Typography className="eyebrow">{isRegister ? "GET STARTED" : "WELCOME BACK"}</Typography>
        <Typography variant="h4" fontWeight={800} sx={{ mt: 1, mb: 1 }}>{isRegister ? "Create your workspace" : "Sign in to your account"}</Typography>
        <Typography color="text.secondary" fontSize={14} sx={{ mb: 3 }}>{isRegister ? "Set up your company workspace in a few steps." : "Enter your details to continue to your workspace."}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box component="form" onSubmit={submit} sx={{ display: "grid", gap: 2 }}>
          {isRegister && <>
            <TextField label="Your full name" value={form.full_name} onChange={update("full_name")} required inputProps={{ minLength: 2 }} />
            <TextField label="Company / organization name" value={form.organization_name} onChange={update("organization_name")} required inputProps={{ minLength: 2 }} />
          </>}
          <TextField label="Work email" type="email" value={form.email} onChange={update("email")} required autoComplete="email" />
          <TextField label="Password" type="password" value={form.password} onChange={update("password")} required autoComplete={isRegister ? "new-password" : "current-password"} inputProps={{ minLength: isRegister ? 10 : 1 }} helperText={isRegister ? "Use at least 10 characters." : undefined} />
          <Button type="submit" variant="contained" size="large" disabled={busy} sx={{ mt: 1, py: 1.4, borderRadius: 2, textTransform: "none", fontWeight: 700 }}>
            {busy ? <CircularProgress size={22} color="inherit" /> : isRegister ? "Create workspace" : "Sign in"}
          </Button>
        </Box>
        <Typography textAlign="center" fontSize={13} sx={{ mt: 3 }} color="text.secondary">
          {isRegister ? "Already have an account? " : "New to GST Reconcile? "}
          <MuiLink component={Link} to={isRegister ? "/login" : "/register"} underline="hover" fontWeight={700}>{isRegister ? "Sign in" : "Create account"}</MuiLink>
        </Typography>
        <Typography color="text.secondary" fontSize={11} textAlign="center" sx={{ mt: 5 }}>Secure workspace · Multi-company ready</Typography>
      </Box>
    </Box>
  </Box>;
}
