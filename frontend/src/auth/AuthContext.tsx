import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import api from "../api/client";
import type { AuthResponse, User } from "../types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { full_name: string; email: string; password: string; organization_name: string }) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("gst_user");
    return saved ? JSON.parse(saved) as User : null;
  });
  const [loading, setLoading] = useState(true);

  const saveSession = (data: AuthResponse) => {
    localStorage.setItem("gst_access_token", data.access_token);
    localStorage.setItem("gst_user", JSON.stringify(data.user));
    if (data.user.memberships[0]) {
      localStorage.setItem("gst_active_organization", String(data.user.memberships[0].id));
    }
    setUser(data.user);
  };

  useEffect(() => {
    const unauthorized = () => setUser(null);
    window.addEventListener("gst:unauthorized", unauthorized);
    const token = localStorage.getItem("gst_access_token");
    if (!token) { setLoading(false); return () => window.removeEventListener("gst:unauthorized", unauthorized); }
    api.get<User>("/auth/me")
      .then(({ data }) => {
        setUser(data);
        localStorage.setItem("gst_user", JSON.stringify(data));
        if (!localStorage.getItem("gst_active_organization") && data.memberships[0]) {
          localStorage.setItem("gst_active_organization", String(data.memberships[0].id));
        }
      })
      .catch(() => {
        localStorage.removeItem("gst_access_token");
        localStorage.removeItem("gst_user");
        setUser(null);
      })
      .finally(() => setLoading(false));
    return () => window.removeEventListener("gst:unauthorized", unauthorized);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    async login(email, password) {
      const { data } = await api.post<AuthResponse>("/auth/login", { email, password });
      saveSession(data);
    },
    async register(payload) {
      const { data } = await api.post<AuthResponse>("/auth/register", payload);
      saveSession(data);
    },
    logout() {
      localStorage.removeItem("gst_access_token");
      localStorage.removeItem("gst_user");
      localStorage.removeItem("gst_active_organization");
      setUser(null);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
