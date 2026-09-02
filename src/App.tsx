import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";

import AdminRoute from "@/components/AdminRoute";
import SuperAdminRoute from "@/components/SuperAdminRoute";
import UserRoute from "@/components/UserRoute";
import DashboardLayout from "@/components/DashboardLayout";
import AdminLayout from "@/components/AdminLayout";
import ScrollToTop from "@/components/ScrollToTop";
import ErrorBoundary from "@/components/ErrorBoundary";
import InquiryWidget from "@/components/InquiryWidget";

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

const LandingPage = lazy(() => import("@/pages/LandingPage"));
const GuestInquiryPage = lazy(() => import("@/pages/GuestInquiryPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const AuthConfirmPage = lazy(() => import("@/pages/AuthConfirmPage"));
const SignUpPage = lazy(() => import("@/pages/SignUpPage"));
const BrowseCarsPage = lazy(() => import("@/pages/BrowseCarsPage"));
const CarDetailPage = lazy(() => import("@/pages/CarDetailPage"));
const MyBookingsPage = lazy(() => import("@/pages/MyBookingsPage"));
const VerificationPage = lazy(() => import("@/pages/VerificationPage"));
const MyVehiclesPage = lazy(() => import("@/pages/MyVehiclesPage"));
const ListerBookingsPage = lazy(() => import("@/pages/ListerBookingsPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const ListerCarRenewalPage = lazy(() => import("@/pages/ListerCarRenewalPage"));
const PrivacyPolicyPage = lazy(() => import("@/pages/PrivacyPolicyPage"));
const TermsPage = lazy(() => import("@/pages/TermsPage"));
const PlatformAgreementPage = lazy(() => import("@/pages/PlatformAgreementPage"));
const SupportTicketsPage = lazy(() => import("@/pages/SupportTicketsPage"));
const PaymentSuccessPage = lazy(() => import("@/pages/PaymentSuccessPage"));
const UpdatePasswordPage = lazy(() => import("@/pages/UpdatePasswordPage"));
const SubscriptionPlansPage = lazy(() => import("@/pages/SubscriptionPlansPage"));
const VehicleAvailabilityPage = lazy(() => import("@/pages/VehicleAvailabilityPage"));
const TripConditionReportPage = lazy(() => import("@/pages/TripConditionReportPage"));
const SecurityDepositPage = lazy(() => import("@/pages/SecurityDepositPage"));
const PrivacyRequestPage = lazy(() => import("@/pages/PrivacyRequestPage"));

const AdminDashboard = lazy(() => import("@/pages/admin/AdminDashboard"));
const AdminLoginPage = lazy(() => import("@/pages/admin/AdminLoginPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage"));
const AdminCarCatalogPage = lazy(() => import("@/pages/admin/AdminCarCatalogPage"));
const AdminVehicleApprovalPage = lazy(() => import("@/pages/admin/AdminVehicleApprovalPage"));
const AdminAuditTrailPage = lazy(() => import("@/pages/admin/AdminAuditTrailPage"));
const AdminFinancialReviewsPage = lazy(() => import("@/pages/admin/AdminFinancialReviewsPage"));
const AdminPlatformSettingsPage = lazy(() => import("@/pages/admin/AdminPlatformSettingsPage"));
const AdminAuditLogsPage = lazy(() => import("@/pages/admin/AdminAuditLogsPage"));
const AdminSupportTicketsPage = lazy(() => import("@/pages/admin/AdminSupportTicketsPage"));
const AdminGuestInquiriesPage = lazy(() => import("@/pages/admin/AdminGuestInquiriesPage"));
const AdminSecurityLogsPage = lazy(() => import("@/pages/admin/AdminSecurityLogsPage"));
const AdminNotificationsPage = lazy(() => import("@/pages/admin/AdminNotificationsPage"));
const AdminFinancialLedgerPage = lazy(() => import("@/pages/admin/AdminFinancialLedgerPage"));
const AdminReconciliationPage = lazy(() => import("@/pages/admin/AdminReconciliationPage"));
const AdminRetentionRequestsPage = lazy(() => import("@/pages/admin/AdminRetentionRequestsPage"));

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
                      <Route path="/admin" element={<AdminDashboard />} />
                      <Route path="/admin/users" element={<AdminUsersPage />} />
                      <Route path="/admin/support" element={<AdminSupportTicketsPage />} />
                      <Route path="/admin/guest-inquiries" element={<AdminGuestInquiriesPage />} />
                      <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
                      <Route
                        path="/admin/car-catalog"
                        element={<AdminCarCatalogPage />}
                      />
                      <Route
                        path="/admin/vehicle-approval"
                        element={<AdminVehicleApprovalPage />}
                      />
                      <Route
                        path="/admin/audit-trail"
                        element={<AdminAuditTrailPage />}
                      />
                      <Route
                        path="/admin/audit-logs"
                        element={<AdminAuditLogsPage />}
                      />
                      <Route
                        path="/admin/security-logs"
                        element={<AdminSecurityLogsPage />}
                      />
                      <Route element={<SuperAdminRoute />}>
                        <Route path="/admin/financial-reviews" element={<AdminFinancialReviewsPage />} />
                        <Route path="/admin/payouts" element={<Navigate to="/admin/financial-reviews?view=payouts" replace />} />
                        <Route path="/admin/refunds" element={<Navigate to="/admin/financial-reviews?view=refunds" replace />} />
                        <Route path="/admin/security-deposits" element={<Navigate to="/admin/financial-reviews?view=deposits" replace />} />
                        <Route path="/admin/financial-ledger" element={<AdminFinancialLedgerPage />} />
                        <Route path="/admin/reconciliation" element={<AdminReconciliationPage />} />
                        <Route path="/admin/retention-requests" element={<AdminRetentionRequestsPage />} />
                      </Route>
                      <Route
                        path="/admin/platform-settings"
                        element={<AdminPlatformSettingsPage />}
                      />
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
