import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Grid, Paper, Typography } from "@mui/material";
import { CheckCircleRounded, CreditCardRounded, LockRounded } from "@mui/icons-material";
import api from "../api/client";

type Plan = { id: number; code: string; name: string; description: string; amount_paise: number; currency: string; billing_interval: string; max_users: number };
type BillingStatus = { status: string; trial_ends_at: string; days_remaining: number; can_use_app: boolean; current_period_end?: string | null; plan?: { name: string; amount_paise: number; currency: string } | null };

declare global {
  interface Window { Razorpay?: new (options: any) => { open: () => void; on: (event: string, callback: (response: any) => void) => void }; }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [p, s] = await Promise.all([api.get<Plan[]>("/billing/plans"), api.get<BillingStatus>("/billing/status")]);
    setPlans(p.data); setStatus(s.data);
  }
  useEffect(() => { refresh().catch(e => setError(e.response?.data?.detail || "Unable to load billing details")).finally(() => setLoading(false)); }, []);

  async function activateDemo(plan: Plan) {
    setBusyPlan(plan.id); setError(""); setMessage("");
    try {
      const { data } = await api.post("/billing/demo-activate", { plan_id: plan.id });
      setMessage(data.message || "Demo plan activated successfully.");
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.detail || "Unable to activate demo plan");
    } finally { setBusyPlan(null); }
  }

  async function checkout(plan: Plan) {
    setBusyPlan(plan.id); setError(""); setMessage("");
    try {
      const loaded = await loadRazorpay();
      if (!loaded) throw new Error("Unable to load secure payment checkout. Check your internet connection.");
      const { data: order } = await api.post("/billing/create-order", { plan_id: plan.id });
      const options = {
        key: order.razorpay_key_id,
        amount: order.amount,
        currency: order.currency,
        name: "GST Reconciliation",
        description: `${plan.name} plan — monthly`,
        order_id: order.order_id,
        theme: { color: "#2458a6" },
        handler: async (response: any) => {
          try {
            await api.post("/billing/verify-payment", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            setMessage("Payment verified. Your subscription is now active.");
            await refresh();
          } catch (e: any) {
            setError(e.response?.data?.detail || "Payment verification is pending. Please contact support before retrying.");
          } finally { setBusyPlan(null); }
        },
        modal: { ondismiss: () => setBusyPlan(null) },
      };
      const razorpay = new window.Razorpay!(options);
      razorpay.on("payment.failed", (response: any) => {
        setError(response.error?.description || "Payment failed. Please try again.");
        setBusyPlan(null);
      });
      razorpay.open();
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || "Unable to start payment");
      setBusyPlan(null);
    }
  }

  if (loading) return <Box sx={{ display: "grid", placeItems: "center", minHeight: 300 }}><CircularProgress /></Box>;

  const trial = status?.status === "TRIALING";
  const active = status?.status === "ACTIVE";
  return <Box>
    <Typography className="eyebrow">ACCOUNT & BILLING</Typography>
    <Typography variant="h4" fontWeight={800} sx={{ mt: .5 }}>Plans & billing</Typography>
    <Typography color="text.secondary" fontSize={14} sx={{ mt: .5, mb: 3 }}>Manage your free trial and choose a plan for your company.</Typography>
    <Alert severity="info" sx={{ mb: 2 }}>Development mode: use “Activate demo plan” to simulate a successful payment. No card/UPI details are needed and no money will be charged.</Alert>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
    {status && <Paper className="panel" elevation={0} sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography fontWeight={800}>Current subscription</Typography>
          <Typography color="text.secondary" fontSize={13} sx={{ mt: .5 }}>
            {trial ? `Your free trial ends on ${new Date(status.trial_ends_at).toLocaleDateString()}.` :
             active ? `Your ${status.plan?.name || ""} plan is active until ${status.current_period_end ? new Date(status.current_period_end).toLocaleDateString() : "the end of the billing period"}.` :
             "Your trial or paid subscription has expired. Choose a plan to restore access."}
          </Typography>
        </Box>
        <Chip color={trial || active ? "success" : "warning"} label={trial ? `FREE TRIAL · ${status.days_remaining} DAYS LEFT` : status.status.replaceAll("_", " ")} />
      </Box>
    </Paper>}
    <Grid container spacing={2}>
      {plans.map((plan, index) => <Grid size={{ xs: 12, md: 4 }} key={plan.id}>
        <Paper className="plan-card" elevation={0} sx={{ height: "100%", borderColor: index === 1 ? "#2458a6" : "#e8edf3" }}>
          {index === 1 && <Chip size="small" color="primary" label="POPULAR" sx={{ mb: 1 }} />}
          <Typography fontWeight={800} fontSize={19}>{plan.name}</Typography>
          <Typography color="text.secondary" fontSize={12} sx={{ minHeight: 38, mt: .5 }}>{plan.description}</Typography>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: .5, my: 2 }}>
            <Typography variant="h4" fontWeight={800}>₹{(plan.amount_paise / 100).toLocaleString("en-IN")}</Typography>
            <Typography color="text.secondary" fontSize={12}>/ month</Typography>
          </Box>
          <Typography color="text.secondary" fontSize={12}>Up to {plan.max_users} users</Typography>
          <Box sx={{ my: 2, display: "grid", gap: 1 }}>
            {["GST purchase register reconciliation", "GSTR-2B comparison", "Discrepancy reports", "Excel exports"].map(feature => <Box key={feature} sx={{ display: "flex", gap: 1, alignItems: "center" }}><CheckCircleRounded sx={{ color: "#16834b", fontSize: 17 }} /><Typography fontSize={12}>{feature}</Typography></Box>)}
          </Box>
          <Button fullWidth variant={index === 1 ? "contained" : "outlined"} disabled={busyPlan !== null || (active && status?.plan?.name === plan.name)} onClick={() => activateDemo(plan)} sx={{ mt: 2, py: 1.2 }}>
            {busyPlan === plan.id ? <CircularProgress size={20} color="inherit" /> : active && status?.plan?.name === plan.name ? "Current plan" : "Activate demo plan · No charge"}
          </Button>
          <Button fullWidth size="small" disabled={busyPlan !== null} onClick={() => checkout(plan)} sx={{ mt: 1 }}>Pay with Razorpay (test/live)</Button>
        </Paper>
      </Grid>)}
    </Grid>
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 3, color: "text.secondary" }}>
      <LockRounded fontSize="small" /><Typography fontSize={11}>Demo activation does not process a payment. Razorpay checkout is available separately when configured.</Typography>
      <CreditCardRounded fontSize="small" />
    </Box>
    <Typography color="text.secondary" fontSize={11} sx={{ mt: 1 }}>Prices shown are configurable launch examples. Applicable taxes, renewal terms and refund policy must be finalized before going live. Payments currently renew manually every 30 days; automatic recurring billing is a separate integration.</Typography>
  </Box>;
}
