import { Navigate, Outlet } from "react-router-dom";
import { CircularProgress, Box } from "@mui/material";
import { useAuth } from "../auth/AuthContext";

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Box className="center-screen"><CircularProgress /></Box>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
