import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar, Avatar, Box, Button, Divider, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, Menu, MenuItem, Toolbar, Typography
} from "@mui/material";
import {
  DashboardRounded, CloudUploadRounded, CompareArrowsRounded, StorefrontRounded,
  AssessmentRounded, SettingsRounded, KeyboardArrowDownRounded, LogoutRounded, CreditCardRounded
} from "@mui/icons-material";
import { useAuth } from "../auth/AuthContext";
import api from "../api/client";

const drawerWidth = 252;
const navItems = [
  { label: "Overview", path: "/", icon: <DashboardRounded /> },
  { label: "File uploads", path: "/uploads", icon: <CloudUploadRounded /> },
  { label: "Reconciliation", path: "/reconciliation", icon: <CompareArrowsRounded /> },
  { label: "Vendors", path: "/vendors", icon: <StorefrontRounded /> },
  { label: "Reports", path: "/reports", icon: <AssessmentRounded /> },
  { label: "Settings", path: "/settings", icon: <SettingsRounded /> },
  { label: "Plans & billing", path: "/billing", icon: <CreditCardRounded /> },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const organization = user?.memberships[0];

  useEffect(() => {
    if (!organization || location.pathname === "/billing") return;
    api.get("/billing/status")
      .then(({ data }) => {
        if (!data.can_use_app) navigate("/billing", { replace: true });
      })
      .catch(() => {
        // A temporary billing API/network error should not lock out an otherwise signed-in user.
      });
  }, [organization?.id, location.pathname, navigate]);

  return <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "#f6f8fb" }}>
    <AppBar position="fixed" elevation={0} sx={{ bgcolor: "#fff", color: "#172033", borderBottom: "1px solid #e8edf3", zIndex: 1201 }}>
      <Toolbar sx={{ minHeight: "72px !important", px: { xs: 2, md: 3 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexGrow: 1 }}>
          <Box className="brand-mark">G</Box>
          <Box><Typography fontWeight={800} fontSize={16}>GST Reconcile</Typography><Typography color="text.secondary" fontSize={11}>FINANCE WORKSPACE</Typography></Box>
        </Box>
        <Button color="inherit" endIcon={<KeyboardArrowDownRounded />} onClick={(e) => setAnchor(e.currentTarget)} sx={{ textTransform: "none", mr: 1 }}>
          <Box sx={{ textAlign: "right", display: { xs: "none", sm: "block" } }}>
            <Typography fontSize={13} fontWeight={700}>{organization?.name || "Workspace"}</Typography>
            <Typography fontSize={11} color="text.secondary">{organization?.role || "Member"}</Typography>
          </Box>
        </Button>
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
          <MenuItem disabled>{user?.email}</MenuItem>
          <Divider />
          <MenuItem onClick={() => { setAnchor(null); logout(); navigate("/login"); }}><LogoutRounded fontSize="small" sx={{ mr: 1 }} />Sign out</MenuItem>
        </Menu>
        <Avatar sx={{ width: 34, height: 34, bgcolor: "#dce8ff", color: "#2458a6", fontSize: 13 }}>{user?.full_name?.slice(0, 1).toUpperCase()}</Avatar>
      </Toolbar>
    </AppBar>
    <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: "border-box", borderRight: "1px solid #e8edf3", bgcolor: "#fff", pt: "88px" }, display: { xs: "none", md: "block" } }}>
      <Box sx={{ px: 2, pb: 1 }}><Typography className="eyebrow">WORKSPACE</Typography></Box>
      <List sx={{ px: 1.5 }}>
        {navItems.map(item => <ListItemButton key={item.path} component={NavLink} to={item.path} end={item.path === "/"} sx={{ borderRadius: 2, mb: .5, color: "#596579", "&.active": { bgcolor: "#edf3ff", color: "#2458a6", fontWeight: 700 }, "&.active .MuiListItemIcon-root": { color: "#2458a6" } }}>
          <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>{item.icon}</ListItemIcon><ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }} />
        </ListItemButton>)}
      </List>
      <Box sx={{ mt: "auto", p: 2 }}><Box className="sidebar-help"><Typography fontWeight={700} fontSize={13}>Need a hand?</Typography><Typography fontSize={12} color="text.secondary" sx={{ my: 1 }}>Your reconciliation workspace is being set up.</Typography><Typography fontSize={12} color="primary.main">Help centre coming soon</Typography></Box></Box>
    </Drawer>
    <Box component="main" sx={{ flexGrow: 1, minWidth: 0, pt: "96px", px: { xs: 2, md: 4 }, pb: 4 }}>
      <Outlet />
    </Box>
  </Box>;
}
