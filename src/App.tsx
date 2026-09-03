import { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";

import AdminRoute from "@/components/AdminRoute";
import SuperAdminRoute from "@/components/SuperAdminRoute";
import PermissionRoute from "@/components/PermissionRoute";
import UserRoute from "@/components/UserRoute";
import DashboardLayout from "@/components/DashboardLayout";
import AdminLayout from "@/components/AdminLayout";
import ScrollToTop from "@/components/ScrollToTop";
import ErrorBoundary from "@/components/ErrorBoundary";
import InquiryWidget from "@/components/InquiryWidget";
import { lazyWithReload } from "@/lib/lazyWithReload";

// Deployment marker: refund review now uses admin-side release details.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const LandingPage = lazyWithReload(() => import("@/pages/LandingPage"));
const GuestInquiryPage = lazyWithReload(() => import("@/pages/GuestInquiryPage"));
const LoginPage = lazyWithReload(() => import("@/pages/LoginPage"));
const AuthConfirmPage = lazyWithReload(() => import("@/pages/AuthConfirmPage"));
const SignUpPage = lazyWithReload(() => import("@/pages/SignUpPage"));
const BrowseCarsPage = lazyWithReload(() => import("@/pages/BrowseCarsPage"));
const CarDetailPage = lazyWithReload(() => import("@/pages/CarDetailPage"));
const MyBookingsPage = lazyWithReload(() => import("@/pages/MyBookingsPage"));
const VerificationPage = lazyWithReload(() => import("@/pages/VerificationPage"));
const MyVehiclesPage = lazyWithReload(() => import("@/pages/MyVehiclesPage"));
const ListerBookingsPage = lazyWithReload(() => import("@/pages/ListerBookingsPage"));
const NotificationsPage = lazyWithReload(() => import("@/pages/NotificationsPage"));
const ListerCarRenewalPage = lazyWithReload(() => import("@/pages/ListerCarRenewalPage"));
const PrivacyPolicyPage = lazyWithReload(() => import("@/pages/PrivacyPolicyPage"));
const TermsPage = lazyWithReload(() => import("@/pages/TermsPage"));
const PlatformAgreementPage = lazyWithReload(() => import("@/pages/PlatformAgreementPage"));
const SupportTicketsPage = lazyWithReload(() => import("@/pages/SupportTicketsPage"));
const InquiriesPage = lazyWithReload(() => import("@/pages/InquiriesPage"));
const PaymentSuccessPage = lazyWithReload(() => import("@/pages/PaymentSuccessPage"));
const UpdatePasswordPage = lazyWithReload(() => import("@/pages/UpdatePasswordPage"));
const SubscriptionPlansPage = lazyWithReload(() => import("@/pages/SubscriptionPlansPage"));
const VehicleAvailabilityPage = lazyWithReload(() => import("@/pages/VehicleAvailabilityPage"));
const TripConditionReportPage = lazyWithReload(() => import("@/pages/TripConditionReportPage"));
const SecurityDepositPage = lazyWithReload(() => import("@/pages/SecurityDepositPage"));
const PrivacyRequestPage = lazyWithReload(() => import("@/pages/PrivacyRequestPage"));

const AdminDashboard = lazyWithReload(() => import("@/pages/admin/AdminDashboard"));
const AdminLoginPage = lazyWithReload(() => import("@/pages/admin/AdminLoginPage"));
const AdminUsersPage = lazyWithReload(() => import("@/pages/admin/AdminUsersPage"));
const AdminCarCatalogPage = lazyWithReload(() => import("@/pages/admin/AdminCarCatalogPage"));
const AdminVehicleApprovalPage = lazyWithReload(() => import("@/pages/admin/AdminVehicleApprovalPage"));
const AdminAuditTrailPage = lazyWithReload(() => import("@/pages/admin/AdminAuditTrailPage"));
const AdminFinancialReviewsPage = lazyWithReload(() => import("@/pages/admin/AdminFinancialReviewsPage"));
const AdminPlatformSettingsPage = lazyWithReload(() => import("@/pages/admin/AdminPlatformSettingsPage"));
const AdminAuditLogsPage = lazyWithReload(() => import("@/pages/admin/AdminAuditLogsPage"));
const AdminSupportTicketsPage = lazyWithReload(() => import("@/pages/admin/AdminSupportTicketsPage"));
const AdminGuestInquiriesPage = lazyWithReload(() => import("@/pages/admin/AdminGuestInquiriesPage"));
const AdminSecurityLogsPage = lazyWithReload(() => import("@/pages/admin/AdminSecurityLogsPage"));
const AdminNotificationsPage = lazyWithReload(() => import("@/pages/admin/AdminNotificationsPage"));
const AdminFinancialLedgerPage = lazyWithReload(() => import("@/pages/admin/AdminFinancialLedgerPage"));
const AdminReconciliationPage = lazyWithReload(() => import("@/pages/admin/AdminReconciliationPage"));
const AdminRetentionRequestsPage = lazyWithReload(() => import("@/pages/admin/AdminRetentionRequestsPage"));
const AdminAdminsPage = lazyWithReload(() => import("@/pages/admin/AdminAdminsPage"));

function RouteLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Loading SafeDrive</p>
        <p className="text-sm text-muted-foreground">
          Preparing the next screen.
        </p>
      </div>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <BrowserRouter>
            <ScrollToTop />
            <AuthProvider>
              <Suspense fallback={<RouteLoader />}>
                <Routes>
                  {/* Public Routes */}
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/contact" element={<GuestInquiryPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/auth/confirm" element={<AuthConfirmPage />} />
                  <Route path="/signup" element={<SignUpPage />} />
                  <Route path="/update-password" element={<UpdatePasswordPage />} />
                  <Route path="/admin/login" element={<AdminLoginPage />} />
                  <Route path="/admin-login" element={<Navigate to="/admin/login" replace />} />
                  <Route path="/Safedriveadminlogin" element={<Navigate to="/admin/login" replace />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/platform-agreement" element={<PlatformAgreementPage />} />

                  {/* Protected User Routes */}
                  <Route element={<UserRoute />}>
                    <Route element={<DashboardLayout />}>
                      <Route path="/browse" element={<BrowseCarsPage />} />
                      <Route path="/cars/:id" element={<CarDetailPage />} />
                      <Route path="/my-bookings" element={<MyBookingsPage />} />
                      <Route path="/verify" element={<VerificationPage />} />
                      <Route path="/my-vehicles" element={<MyVehiclesPage />} />
                      <Route
                        path="/lister-bookings"
                        element={<ListerBookingsPage />}
                      />
                      <Route
                        path="/notifications"
                        element={<NotificationsPage />}
                      />
                      <Route
                        path="/car-renewals"
                        element={<ListerCarRenewalPage />}
                      />
                      <Route
                        path="/support"
                        element={<SupportTicketsPage />}
                      />
                      <Route path="/inquiries" element={<InquiriesPage />} />
                      <Route
                        path="/payment/success"
                        element={<PaymentSuccessPage />}
                      />
                      <Route
                        path="/subscriptions"
                        element={<SubscriptionPlansPage />}
                      />
                      <Route path="/vehicle-availability" element={<VehicleAvailabilityPage />} />
                      <Route path="/trip-report/:bookingId/:phase" element={<TripConditionReportPage />} />
                      <Route path="/security-deposit/:bookingId" element={<SecurityDepositPage />} />
                      <Route path="/privacy-request" element={<PrivacyRequestPage />} />
                    </Route>
                  </Route>

                  {/* Admin Routes */}
                  <Route element={<AdminRoute />}>
                    <Route element={<AdminLayout />}>
                      {/* Any staff member */}
                      <Route path="/admin" element={<AdminDashboard />} />
                      <Route path="/admin/notifications" element={<AdminNotificationsPage />} />

                      {/* Operational routes - gated by the admin checklist */}
                      <Route element={<PermissionRoute anyOf={["users.verify", "users.moderate"]} />}>
                        <Route path="/admin/users" element={<AdminUsersPage />} />
                      </Route>
                      <Route element={<PermissionRoute anyOf={["support.handle"]} />}>
                        <Route path="/admin/support" element={<AdminSupportTicketsPage />} />
                      </Route>
                      <Route element={<PermissionRoute anyOf={["inquiries.handle"]} />}>
                        <Route path="/admin/guest-inquiries" element={<AdminGuestInquiriesPage />} />
                      </Route>
                      <Route element={<PermissionRoute anyOf={["catalog.manage"]} />}>
                        <Route path="/admin/car-catalog" element={<AdminCarCatalogPage />} />
                      </Route>
                      <Route element={<PermissionRoute anyOf={["vehicles.review", "vehicles.delete"]} />}>
                        <Route path="/admin/vehicle-approval" element={<AdminVehicleApprovalPage />} />
                      </Route>
                      <Route element={<PermissionRoute anyOf={["audit.view"]} />}>
                        <Route path="/admin/audit-trail" element={<AdminAuditTrailPage />} />
                        <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
                      </Route>
                      <Route element={<PermissionRoute anyOf={["security.view"]} />}>
                        <Route path="/admin/security-logs" element={<AdminSecurityLogsPage />} />
                      </Route>

                      {/* Super-admin-only routes */}
                      <Route element={<SuperAdminRoute />}>
                        <Route path="/admin/admins" element={<AdminAdminsPage />} />
                        <Route path="/admin/platform-settings" element={<AdminPlatformSettingsPage />} />
                        <Route path="/admin/financial-reviews" element={<AdminFinancialReviewsPage />} />
                        <Route path="/admin/payouts" element={<Navigate to="/admin/financial-reviews?view=payouts" replace />} />
                        <Route path="/admin/refunds" element={<Navigate to="/admin/financial-reviews?view=refunds" replace />} />
                        <Route path="/admin/security-deposits" element={<Navigate to="/admin/financial-reviews?view=deposits" replace />} />
                        <Route path="/admin/financial-ledger" element={<AdminFinancialLedgerPage />} />
                        <Route path="/admin/reconciliation" element={<AdminReconciliationPage />} />
                        <Route path="/admin/retention-requests" element={<AdminRetentionRequestsPage />} />
                      </Route>
                    </Route>
                  </Route>

                  {/* Catch-all */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
              <InquiryWidget />
              <Toaster position="top-right" richColors />
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
