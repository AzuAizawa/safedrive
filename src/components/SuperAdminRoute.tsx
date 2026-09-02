import { Navigate, Outlet } from "react-router";

import { useAuth } from "@/contexts/AuthContext";

export default function SuperAdminRoute() {
  const { profile } = useAuth();

  if (profile?.role !== "super_admin") {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}
