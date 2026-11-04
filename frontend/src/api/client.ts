import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1",
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("gst_access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const organizationId = localStorage.getItem("gst_active_organization");
  if (organizationId) config.headers["X-Organization-ID"] = organizationId;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("gst_access_token");
      localStorage.removeItem("gst_user");
      window.dispatchEvent(new Event("gst:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export default api;
