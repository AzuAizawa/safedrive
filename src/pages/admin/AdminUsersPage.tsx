import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { createPrivateStorageUrlMap } from "@/lib/privateStorage";
import { useAuth } from "@/contexts/AuthContext";
import {
  getProvenanceBadge,
  getReviewFlagBadge,
  type ProvenanceStatus,
  type ReviewFlag,
} from "@/lib/contentProvenance";
import {
  runKycOcrReview,
  type KycOcrProgress,
  type KycOcrReview,
} from "@/lib/kycOcr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck,
  Search,
  CheckCircle,
  XCircle,
  X,
  Eye,
  Loader2,
  Maximize2,
  Zap,
  AlertCircle,
  ZoomIn,
  KeyRound,
  Smartphone,
} from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Profile, VerificationImage } from "@/types/database";

interface UserWithImages extends Profile {
  verification_images: VerificationImage[];
}

const KYC_OCR_DOCUMENT_TYPES = new Set([
  "license_front",
  "license_back",
  "national_id_front",
]);

const kycCheckClassName = (status: KycOcrReview["checks"][number]["status"]) => {
  if (status === "match") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "unreadable") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
};

export default function AdminUsersPage() {
  const minimumBlockReasonLength = 10;
  const { user: adminUser, profile: adminProfile, can } = useAuth();
  const isSuperAdmin = adminProfile?.role === "super_admin";
  const canVerify = can("users.verify");
  const canModerate = can("users.moderate");
  const [users, setUsers] = useState<UserWithImages[]>([]);
  const [verificationImageUrls, setVerificationImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserWithImages | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showBlockInput, setShowBlockInput] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blockDurationHours, setBlockDurationHours] = useState("24");
  const [showPasswordResetInput, setShowPasswordResetInput] = useState(false);
  const [showAuthenticatorResetConfirm, setShowAuthenticatorResetConfirm] =
    useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [confirmResetPasswordValue, setConfirmResetPasswordValue] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    type: string;
  } | null>(null);
  const [piiLoading, setPiiLoading] = useState(false);
  const [decryptedPii, setDecryptedPii] = useState<{
    driver_license: string | null;
  }>({
    driver_license: null,
  });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [checklist, setChecklist] = useState({
    nameMatch: false,
    idMatch: false,
    faceMatch: false,
    validExpiry: false,
  });
  const [kycOcrReview, setKycOcrReview] = useState<KycOcrReview | null>(null);
  const [kycOcrProgress, setKycOcrProgress] = useState<KycOcrProgress | null>(null);
  const [kycOcrError, setKycOcrError] = useState("");
  const [kycOcrRunning, setKycOcrRunning] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      setDecryptedPii({
        driver_license: null,
      });
      return;
    }

    let isMounted = true;
    const decryptField = async (value: string | null) => {
      if (!value) return null;
      if (!value.startsWith("pgp:")) return value;

      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string | null; error: { message: string } | null }>
      )("decrypt_pii", { encrypted_content: value });

      if (error) {
        console.warn("Unable to decrypt PII for admin review:", error.message);
        return null;
      }
      return data;
    };

    const loadPii = async () => {
      setPiiLoading(true);
      try {
        const [driverLicense] = await Promise.all([
          decryptField(selectedUser.driver_license),
        ]);

        if (isMounted) {
          setDecryptedPii({
            driver_license: driverLicense,
          });
        }
      } finally {
        if (isMounted) setPiiLoading(false);
      }
    };

    void loadPii();

    return () => {
      isMounted = false;
    };
  }, [selectedUser]);

  useEffect(() => {
    setKycOcrReview(null);
    setKycOcrProgress(null);
    setKycOcrError("");
    setKycOcrRunning(false);
  }, [selectedUser?.id]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("role", "user")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const profiles = (data ?? []) as Profile[];
      const userIds = profiles.map((profile) => profile.id);
      let imagesByUser: Record<string, VerificationImage[]> = {};

      if (userIds.length > 0) {
        const { data: imageRows, error: imageError } = await supabase
          .from("verification_images")
          .select("*")
          .in("user_id", userIds);

        if (imageError) {
          console.warn("Failed to load verification images:", imageError.message);
          toast.warning("Users loaded, but verification images could not be loaded.", {
            description: "Run the latest database update if admin review images are missing.",
          });
        } else {
          imagesByUser = (imageRows ?? []).reduce<Record<string, VerificationImage[]>>(
            (accumulator, image) => {
              accumulator[image.user_id] = accumulator[image.user_id] ?? [];
              accumulator[image.user_id].push(image as VerificationImage);
              return accumulator;
            },
            {},
          );
        }
      }

      setUsers(
        profiles.map((profile) => ({
          ...profile,
          verification_images: imagesByUser[profile.id] ?? [],
        })),
      );
      setVerificationImageUrls(
        await createPrivateStorageUrlMap(
          "user-verification",
          Object.values(imagesByUser).flatMap((images) => images.map((image) => image.storage_path)),
        ),
      );
    } catch (err) {
      console.error("Failed to load users:", err);
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesFilter = filter === "all" || u.verified_status === filter;
    const matchesSearch =
      search === "" ||
      (u.full_name || "").toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getImageUrl = (path: string, _cacheKey?: string | null) =>
    verificationImageUrls[path] ?? "";

  const isLoginBlocked = (userRecord: UserWithImages | null) =>
    Boolean(
      userRecord?.login_blocked_until &&
        new Date(userRecord.login_blocked_until).getTime() > Date.now(),
    );

  const displayPii = (
    rawValue: string | null,
    decryptedValue: string | null,
  ) => {
    if (piiLoading) return "Decrypting...";
    if (decryptedValue) return decryptedValue;
    if (rawValue && !rawValue.startsWith("pgp:")) return rawValue;
    if (rawValue?.startsWith("pgp:")) return "Encrypted value unavailable";
    return "—";
  };

  const piiNeedsAttention = (
    rawValue: string | null,
    decryptedValue: string | null,
  ) => Boolean(rawValue?.startsWith("pgp:") && !decryptedValue && !piiLoading);

  const asProvenanceStatus = (value: string): ProvenanceStatus =>
    ["credential_present", "credential_missing", "credential_invalid"].includes(
      value,
    )
      ? (value as ProvenanceStatus)
      : "unknown";

  const asReviewFlag = (value: string): ReviewFlag =>
    [
      "needs_admin_review",
      "approved_after_review",
      "rejected_after_review",
    ].includes(value)
      ? (value as ReviewFlag)
      : "none";

  const getVerificationProvenanceSummary = (images: VerificationImage[]) => ({
    total_images: images.length,
    c2pa_signal_count: images.filter(
      (img) => img.provenance_status === "credential_present",
    ).length,
    missing_c2pa_count: images.filter(
      (img) => img.provenance_status === "credential_missing",
    ).length,
    manual_review_count: images.filter(
      (img) => img.review_flag === "needs_admin_review",
    ).length,
  });

  const getKycOcrAuditSummary = () => {
    if (!kycOcrReview) return null;
    return {
      checked_at: kycOcrReview.checkedAt,
      documents: kycOcrReview.documents.map((document) => ({
        type: document.type,
        status: document.status,
        confidence: document.confidence,
        text_length: document.textLength,
      })),
      checks: kycOcrReview.checks.map((check) => ({
        id: check.id,
        status: check.status,
      })),
    };
  };

  const runKycOcr = async () => {
    if (!selectedUser || kycOcrRunning) return;

    const documents = selectedUser.verification_images
      .filter((image) => KYC_OCR_DOCUMENT_TYPES.has(image.image_type))
      .map((image) => ({
        type: image.image_type,
        url: getImageUrl(image.storage_path, image.created_at),
      }))
      .filter((image) => Boolean(image.url));

    if (documents.length === 0) {
      toast.error("No readable ID documents are available for OCR");
      return;
    }

    const storedLicense = selectedUser.driver_license?.startsWith("pgp:")
      ? null
      : selectedUser.driver_license;
    setKycOcrRunning(true);
    setKycOcrReview(null);
    setKycOcrError("");
    setKycOcrProgress({
      documentType: documents[0].type,
      status: "starting OCR engine",
      progress: 0,
    });

    try {
      const result = await runKycOcrReview({
        documents,
        expected: {
          fullName: selectedUser.full_name,
          driverLicense: decryptedPii.driver_license || storedLicense,
        },
        onProgress: setKycOcrProgress,
      });
      setKycOcrReview(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "KYC OCR could not run.";
      setKycOcrError(message);
      toast.error("KYC OCR failed", { description: message });
    } finally {
      setKycOcrRunning(false);
    }
  };

  const stampVerificationImagesReviewed = async (
    userId: string,
    reviewFlag: "approved_after_review" | "rejected_after_review",
    reason: string | null,
  ) => {
    const { error } = await supabase
      .from("verification_images")
      .update({
        review_flag: reviewFlag,
        review_reason: reason,
        reviewed_by: adminUser?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      console.warn("Unable to stamp verification image review:", error.message);
    }
  };

  const isStrongPassword = (value: string) =>
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[!@#$%^&*(),.?":{}|<>]/.test(value);

  const sendVerificationDecisionEmail = async (
    target: UserWithImages,
    status: "verified" | "rejected",
  ) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return "not_attempted";
    try {
      const response = await fetch("/api/send-verification-decision-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId: target.id, status }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        deliveryState?: string;
      };
      if (!response.ok || body.deliveryState !== "sent") {
        console.warn("Verification decision email was not delivered", {
          status,
          deliveryState: body.deliveryState ?? "unknown",
        });
      }
      return body.deliveryState ?? "unknown";
    } catch (emailError) {
      console.warn("Verification decision email request failed", emailError);
      return "failed";
    }
  };

  const handleApprove = async () => {
    if (!selectedUser || !adminUser) return;
    setActionLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({ verified_status: "verified", rejection_reason: null })
      .eq("id", selectedUser.id);

    if (!error) {
      await stampVerificationImagesReviewed(
        selectedUser.id,
        "approved_after_review",
        "Identity verification approved by admin after manual review.",
      );
      // Notification
      const { error: notificationError } = await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        title: "Verification Approved!",
        message:
          "Your identity has been verified. You now have full access to SafeDrive.",
        type: "success",
        link: "/browse",
      });
      if (notificationError) {
        console.warn("Verification approval notification failed:", notificationError.message);
      }
      const approvalEmailState = await sendVerificationDecisionEmail(selectedUser, "verified");
      if (approvalEmailState === "not_configured") {
        toast.warning("Verification approved, but email is not configured yet.");
      } else if (approvalEmailState !== "sent") {
        toast.warning("Verification approved, but the notification email was not delivered.");
      }
      // Audit
      await supabase.from("audit_log").insert({
        user_id: adminUser.id,
        action: "admin_approved_verification",
        entity_type: "profile",
        entity_id: selectedUser.id,
          details: {
            admin_email: adminUser.email,
            provenance: getVerificationProvenanceSummary(
              selectedUser.verification_images,
            ),
            kyc_ocr: getKycOcrAuditSummary(),
        },
      });
      toast.success(
        `${selectedUser.full_name || selectedUser.email} approved!`,
      );
      setSelectedUser(null);
      fetchUsers();
    } else {
      toast.error("Failed to approve");
    }
    setActionLoading(false);
  };

  const handleReject = async () => {
    if (!selectedUser || !adminUser || !rejectionReason.trim()) {
      toast.error("Please provide a reason for rejection");
      return;
    }
    setActionLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        verified_status: "rejected",
        rejection_reason: rejectionReason,
      })
      .eq("id", selectedUser.id);

    if (!error) {
      await stampVerificationImagesReviewed(
        selectedUser.id,
        "rejected_after_review",
        rejectionReason.trim(),
      );
      const { error: notificationError } = await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        title: "Verification Rejected",
        message: `Your verification was rejected. Reason: ${rejectionReason}`,
        type: "error",
        link: "/verify",
      });
      if (notificationError) {
        console.warn("Verification rejection notification failed:", notificationError.message);
      }
      const rejectionEmailState = await sendVerificationDecisionEmail(selectedUser, "rejected");
      if (rejectionEmailState === "not_configured") {
        toast.warning("Verification was updated, but email is not configured yet.");
      } else if (rejectionEmailState !== "sent") {
        toast.warning("Verification was updated, but the notification email was not delivered.");
      }
      await supabase.from("audit_log").insert({
        user_id: adminUser.id,
        action: "admin_rejected_verification",
        entity_type: "profile",
        entity_id: selectedUser.id,
          details: {
            reason: rejectionReason,
            provenance: getVerificationProvenanceSummary(
              selectedUser.verification_images,
            ),
            kyc_ocr: getKycOcrAuditSummary(),
        },
      });
      toast.success("User verification rejected");
      setSelectedUser(null);
      setRejectionReason("");
      setShowRejectInput(false);
      fetchUsers();
    }
    setActionLoading(false);
  };

  const handleBlockLogin = async () => {
    if (
      !selectedUser ||
      !adminUser ||
      blockReason.trim().length < minimumBlockReasonLength
    ) {
      toast.error(
        `Please provide at least ${minimumBlockReasonLength} characters before blocking sign-in`,
      );
      return;
    }

    setActionLoading(true);
    const blockedUntil = new Date(
      Date.now() + Number(blockDurationHours) * 60 * 60 * 1000,
    ).toISOString();

    const { error } = await supabase
      .from("profiles")
      .update({
        login_blocked_until: blockedUntil,
        login_block_reason: blockReason.trim(),
      })
      .eq("id", selectedUser.id);

    if (!error) {
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        title: "Account Sign-in Temporarily Blocked",
        message: `SafeDrive temporarily blocked sign-in to your account. Reason: ${blockReason.trim()}`,
        type: "error",
        link: "/login",
      });
      await supabase.from("audit_log").insert({
        user_id: adminUser.id,
        action: "admin_blocked_login_access",
        entity_type: "profile",
        entity_id: selectedUser.id,
        details: {
          reason: blockReason.trim(),
          blocked_until: blockedUntil,
        },
      });
      toast.success("Login access blocked");
      setSelectedUser(null);
      setBlockReason("");
      setBlockDurationHours("24");
      setShowBlockInput(false);
      fetchUsers();
    } else {
      toast.error("Failed to block login");
    }

    setActionLoading(false);
  };

  const handleUnblockLogin = async () => {
    if (!selectedUser || !adminUser) return;
    setActionLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        login_blocked_until: null,
        login_block_reason: null,
      })
      .eq("id", selectedUser.id);

    if (!error) {
      await supabase.from("notifications").insert({
        user_id: selectedUser.id,
        title: "Account Sign-in Restored",
        message: "SafeDrive restored sign-in access to your account.",
        type: "success",
        link: "/login",
      });
      await supabase.from("audit_log").insert({
        user_id: adminUser.id,
        action: "admin_unblocked_login_access",
        entity_type: "profile",
        entity_id: selectedUser.id,
      });
      toast.success("Login access restored");
      setSelectedUser(null);
      setBlockReason("");
      setBlockDurationHours("24");
      setShowBlockInput(false);
      fetchUsers();
    } else {
      toast.error("Failed to restore login");
    }

    setActionLoading(false);
  };

  const handleSuperAdminPasswordReset = async () => {
    if (!selectedUser || !adminUser || !isSuperAdmin) return;

    if (!isStrongPassword(resetPasswordValue)) {
      toast.error("Temporary password does not meet the password rules");
      return;
    }

    if (resetPasswordValue !== confirmResetPasswordValue) {
      toast.error("Temporary password and confirmation do not match");
      return;
    }

    setActionLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your admin session expired. Sign in again first.");
      }

      const response = await fetch("/api/admin-reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          targetUserId: selectedUser.id,
          newPassword: resetPasswordValue,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to reset password");
      }

      toast.success("Password reset saved", {
        description:
          "Share the temporary password with the user through your secure support process.",
      });
      setShowPasswordResetInput(false);
      setResetPasswordValue("");
      setConfirmResetPasswordValue("");
    } catch (error) {
      toast.error("Password reset failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuperAdminAuthenticatorReset = async () => {
    if (!selectedUser || !adminUser || !isSuperAdmin) return;

    setActionLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your admin session expired. Sign in again first.");
      }

      const response = await fetch("/api/admin-reset-authenticator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ targetUserId: selectedUser.id }),
      });

      const payload = (await response.json()) as {
        error?: string;
        cleared?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to reset authenticator");
      }

      toast.success("Authenticator reset", {
        description:
          (payload.cleared ?? 0) > 0
            ? "The user will be prompted to scan a new QR code on their next sign-in."
            : "This user had no authenticator enrolled.",
      });
      setShowAuthenticatorResetConfirm(false);
    } catch (error) {
      toast.error("Authenticator reset failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
        <p className="text-muted-foreground mt-1">
          Review and manage user verifications
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
        <Select value={filter} onValueChange={(val) => setFilter(val || "all")}>
          <SelectTrigger className="w-full sm:w-48 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-10 text-muted-foreground"
                  >
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((u) => (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      setSelectedUser(u);
                      setShowRejectInput(false);
                      setRejectionReason("");
                      setShowBlockInput(false);
                      setBlockReason("");
                      setBlockDurationHours("24");
                      setShowPasswordResetInput(false);
                      setResetPasswordValue("");
                      setConfirmResetPasswordValue("");
                      setChecklist({
                        nameMatch: false,
                        idMatch: false,
                        faceMatch: false,
                        validExpiry: false,
                      });
                    }}
                  >
                    <TableCell className="font-medium">
                      {u.full_name || "—"}
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.verified_status === "verified"
                            ? "text-green-600 bg-green-50 dark:bg-green-950/30"
                            : u.verified_status === "pending"
                              ? "text-amber-600 bg-amber-50 dark:bg-amber-950/30"
                              : u.verified_status === "rejected"
                                ? "text-red-600 bg-red-50 dark:bg-red-950/30"
                                : "text-muted-foreground bg-muted"
                        }`}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        {u.verified_status.charAt(0).toUpperCase() +
                          u.verified_status.slice(1)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {format(new Date(u.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedUser(u);
                          setShowRejectInput(false);
                          setRejectionReason("");
                          setShowBlockInput(false);
                          setBlockReason("");
                          setBlockDurationHours("24");
                          setShowPasswordResetInput(false);
                          setResetPasswordValue("");
                          setConfirmResetPasswordValue("");
                        }}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* User Detail Modal */}
      {selectedUser &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 py-6 sm:items-center"
            onClick={() => setSelectedUser(null)}
          >
            <div
              className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[calc(100vh-2rem)] sm:max-h-[90vh] flex flex-col animate-scale-in overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-background z-10 shrink-0">
                <h2 className="text-xl font-bold">User Verification</h2>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSelectedUser(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
                {/* Personal Info */}
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Full Name:</span>
                    <p className="font-medium">
                      {selectedUser.full_name || "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>
                    <p className="font-medium">{selectedUser.email}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>
                    <p className="font-medium">{selectedUser.phone || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Birthday:</span>
                    <p className="font-medium">
                      {selectedUser.birthday
                        ? format(new Date(selectedUser.birthday), "MMM d, yyyy")
                        : "—"}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Address:</span>
                    <p className="font-medium">{selectedUser.address || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Driver's License:
                    </span>
                    <p className="font-medium">
                      {displayPii(
                        selectedUser.driver_license,
                        decryptedPii.driver_license,
                      )}
                    </p>
                    {piiNeedsAttention(
                      selectedUser.driver_license,
                      decryptedPii.driver_license,
                    ) && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Stored value is encrypted but could not be decrypted in this session. Check the live `decrypt_pii` function and grants if this keeps happening.
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Secondary ID / Backup ID Type:
                    </span>
                    <p className="font-medium">
                      {selectedUser.secondary_id_type || "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Payout Method:</span>
                    <p className="font-medium">
                      {selectedUser.payout_method || "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Payout Account Name:</span>
                    <p className="font-medium">
                      {selectedUser.payout_account_name || "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Payout Account Number:</span>
                    <p className="font-medium">
                      {selectedUser.payout_account_number || "—"}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Sign-in Access:</span>
                    <p className="font-medium">
                      {isLoginBlocked(selectedUser)
                        ? `Blocked until ${format(new Date(selectedUser.login_blocked_until!), "MMM d, yyyy h:mm a")}`
                        : "Active"}
                    </p>
                    {isLoginBlocked(selectedUser) && selectedUser.login_block_reason && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        Reason: {selectedUser.login_block_reason}
                      </p>
                    )}
                  </div>
                </div>

                {/* Verification Images */}
                {selectedUser.verification_images.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3 flex items-center justify-between">
                      Uploaded Documents
                      <span className="text-xs font-normal text-muted-foreground items-center flex gap-1">
                        <ZoomIn className="w-3 h-3" /> Click image for Deep Zoom
                      </span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {selectedUser.verification_images.map((img) => (
                        <div key={img.id} className="group relative space-y-1">
                          <p className="text-xs text-muted-foreground capitalize">
                            {img.image_type.replace(/_/g, " ")}
                          </p>
                          <div
                            className="relative aspect-video overflow-hidden rounded-lg border border-border group-hover:ring-2 group-hover:ring-primary transition-all cursor-zoom-in"
                            onClick={() => {
                              setPreviewImage({
                                url: getImageUrl(img.storage_path, img.created_at),
                                type: img.image_type,
                              });
                              setZoomLevel(1);
                            }}
                          >
                            <img
                              src={getImageUrl(img.storage_path, img.created_at)}
                              alt={img.image_type}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                              {(() => {
                                const badge = getProvenanceBadge(
                                  asProvenanceStatus(img.provenance_status),
                                );
                                return (
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                );
                              })()}
                              {asReviewFlag(img.review_flag) !== "none" &&
                                (() => {
                                  const badge = getReviewFlagBadge(
                                    asReviewFlag(img.review_flag),
                                  );
                                  return (
                                    <span
                                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                                    >
                                      {badge.label}
                                    </span>
                                  );
                                })()}
                            </div>
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Maximize2 className="w-6 h-6 text-white" />
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            {img.provenance_summary ||
                              "No provenance scan summary is stored for this upload."}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Consistency Flagging Assistant */}
                <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" />
                      Automated Consistency Flags
                    </h3>
                    <span className="text-[10px] uppercase font-bold text-primary/60 tracking-wider">
                      Experimental OCR Info
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1.5 p-2 rounded bg-background/50 border border-border/50">
                      <p className="text-muted-foreground">Form Full Name</p>
                      <p className="font-mono text-sm font-semibold">
                        {selectedUser.full_name || "N/A"}
                      </p>
                    </div>
                    <div className="space-y-1.5 p-2 rounded bg-background/50 border border-border/50">
                      <p className="text-muted-foreground">
                        License and Secondary ID / Backup ID
                      </p>
                      <div className="flex flex-col gap-1">
                        <span className="font-mono">
                          DL:{" "}
                          {displayPii(
                            selectedUser.driver_license,
                            decryptedPii.driver_license,
                          )}
                        </span>
                        <span className="font-mono">
                          Secondary ID / Backup ID Type:{" "}
                          {selectedUser.secondary_id_type || "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-primary/15 bg-background/50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">KYC OCR comparison</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reads uploaded ID documents and compares text with the submitted name and license number. It does not verify document authenticity or faces, and it never approves or rejects automatically.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => void runKycOcr()}
                        disabled={kycOcrRunning || piiLoading || selectedUser.verification_images.length === 0}
                      >
                        {kycOcrRunning && <Loader2 className="h-4 w-4 animate-spin" />}
                        {kycOcrRunning ? "Reading documents…" : "Run KYC OCR"}
                      </Button>
                    </div>

                    {kycOcrProgress && (
                      <p className="text-xs text-muted-foreground" aria-live="polite">
                        {kycOcrProgress.documentType.replace(/_/g, " ")}: {kycOcrProgress.status} ({Math.round(kycOcrProgress.progress * 100)}%)
                      </p>
                    )}

                    {kycOcrError && (
                      <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
                        {kycOcrError}
                      </p>
                    )}

                    {kycOcrReview && (
                      <div className="space-y-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          {kycOcrReview.checks.map((check) => (
                            <div key={check.id} className={`rounded border p-2 text-xs ${kycCheckClassName(check.status)}`}>
                              <p className="font-semibold">{check.label}: {check.status.replace(/_/g, " ")}</p>
                              <p className="mt-1 leading-snug">{check.summary}</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {kycOcrReview.documents.map((document) => `${document.type.replace(/_/g, " ")}: ${document.status === "read" ? `${Math.round(document.confidence ?? 0)}% confidence` : "could not be read"}`).join(" · ")}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Mandatory Review Checklist */}
                  {selectedUser.verified_status === "pending" && (
                    <div className="space-y-3 pt-4 border-t border-primary/10 mt-4">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                        Manual Review Checklist
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "nameMatch", label: "Name matches IDs" },
                          { id: "idMatch", label: "ID numbers match" },
                          { id: "faceMatch", label: "Faces match selfie" },
                          { id: "validExpiry", label: "Docs are valid" },
                        ].map((item) => (
                          <label
                            key={item.id}
                            className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                              checked={
                                checklist[item.id as keyof typeof checklist]
                              }
                              onChange={(e) =>
                                setChecklist((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.checked,
                                }))
                              }
                            />
                            <span className="text-xs font-medium">
                              {item.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Rejection reason input */}
                {showRejectInput && (
                  <div className="space-y-2">
                    <Label>Rejection Reason *</Label>
                    <Input
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Explain why the verification is rejected..."
                    />
                  </div>
                )}

                {showBlockInput && (
                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                    <div className="space-y-2">
                      <Label>Login Block Reason *</Label>
                    <Input
                      value={blockReason}
                      onChange={(e) => setBlockReason(e.target.value)}
                      placeholder="Explain why sign-in should be blocked..."
                      minLength={minimumBlockReasonLength}
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum {minimumBlockReasonLength} characters.
                    </p>
                  </div>
                    <div className="space-y-2">
                      <Label>Block Duration</Label>
                      <Select
                        value={blockDurationHours}
                        onValueChange={(value) => setBlockDurationHours(value ?? "24")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24">24 hours</SelectItem>
                          <SelectItem value="168">7 days</SelectItem>
                          <SelectItem value="720">30 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Actions */}
                {selectedUser.verified_status === "pending" && canVerify && (
                  <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
                    <Button
                      onClick={handleApprove}
                      disabled={
                        actionLoading ||
                        !Object.values(checklist).every(Boolean)
                      }
                      className="gap-2 sm:flex-1 shadow-lg shadow-primary/20"
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      Approve Identity
                    </Button>
                    {!showRejectInput ? (
                      <Button
                        variant="outline"
                        onClick={() => setShowRejectInput(true)}
                        className="gap-2 text-destructive border-destructive/20 hover:bg-destructive/10"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        onClick={handleReject}
                        disabled={actionLoading || !rejectionReason.trim()}
                        className="gap-2"
                      >
                        {actionLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <XCircle className="w-4 h-4" />
                        )}
                        Confirm Reject
                      </Button>
                    )}
                  </div>
                )}

                {!Object.values(checklist).every(Boolean) &&
                  selectedUser.verified_status === "pending" &&
                  canVerify && (
                    <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
                      <AlertCircle className="w-2.5 h-2.5" />
                      Complete all checklist items to enable approval
                    </p>
                  )}

                <div
                  className="rounded-lg border border-border/70 bg-muted/20 p-4 space-y-3"
                  hidden={!canModerate}
                >
                  <div>
                    <p className="text-sm font-semibold">Sign-in Access Control</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Temporarily block repeated suspicious sign-in activity, then restore access when the account is safe again.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    {!isLoginBlocked(selectedUser) && !showBlockInput ? (
                      <Button
                        variant="outline"
                        onClick={() => setShowBlockInput(true)}
                        className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                      >
                        Block Sign-in
                      </Button>
                    ) : null}
                    {showBlockInput ? (
                      <Button
                        variant="destructive"
                        onClick={handleBlockLogin}
                        disabled={
                          actionLoading ||
                          blockReason.trim().length < minimumBlockReasonLength
                        }
                        className="gap-2"
                      >
                        {actionLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : null}
                        Confirm Block
                      </Button>
                    ) : null}
                    {isLoginBlocked(selectedUser) ? (
                      <Button
                        variant="outline"
                        onClick={handleUnblockLogin}
                        disabled={actionLoading}
                        className="gap-2 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
                      >
                        {actionLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : null}
                        Restore Sign-in
                      </Button>
                    ) : null}
                  </div>
                </div>

                {isSuperAdmin ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3 dark:border-blue-900/50 dark:bg-blue-950/20">
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <KeyRound className="w-4 h-4" />
                        Super Admin Password Reset
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Set a temporary password for this user when the normal recovery flow cannot be completed. Share it securely outside the app.
                      </p>
                    </div>
                    {!showPasswordResetInput ? (
                      <Button
                        variant="outline"
                        onClick={() => setShowPasswordResetInput(true)}
                        className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                      >
                        <KeyRound className="w-4 h-4" />
                        Set Temporary Password
                      </Button>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label>Temporary Password *</Label>
                          <Input
                            type="text"
                            value={resetPasswordValue}
                            onChange={(e) => setResetPasswordValue(e.target.value)}
                            placeholder="At least 8 chars, uppercase, number, special"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Confirm Temporary Password *</Label>
                          <Input
                            type="text"
                            value={confirmResetPasswordValue}
                            onChange={(e) => setConfirmResetPasswordValue(e.target.value)}
                            placeholder="Re-enter temporary password"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Password rules match the normal sign-up rules.
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button
                            onClick={handleSuperAdminPasswordReset}
                            disabled={
                              actionLoading ||
                              !isStrongPassword(resetPasswordValue) ||
                              resetPasswordValue !== confirmResetPasswordValue
                            }
                            className="gap-2"
                          >
                            {actionLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <KeyRound className="w-4 h-4" />
                            )}
                            Confirm Password Reset
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setShowPasswordResetInput(false);
                              setResetPasswordValue("");
                              setConfirmResetPasswordValue("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {isSuperAdmin ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3 dark:border-blue-900/50 dark:bg-blue-950/20">
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <Smartphone className="w-4 h-4" />
                        Reset Authenticator (MFA)
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Clears this user&apos;s enrolled authenticator app when
                        they have lost the device and cannot use the email-code
                        fallback. They scan a fresh QR code on their next
                        sign-in.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setShowAuthenticatorResetConfirm(true)}
                      disabled={actionLoading}
                      className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                    >
                      <Smartphone className="w-4 h-4" />
                      Reset Authenticator
                    </Button>
                  </div>
                ) : null}

                {selectedUser.verified_status === "rejected" &&
                  selectedUser.rejection_reason && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50">
                      <p className="text-sm text-red-700 dark:text-red-400">
                        <strong>Rejected:</strong>{" "}
                        {selectedUser.rejection_reason}
                      </p>
                    </div>
                  )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      {/* Deep Zoom Lightbox Overlay */}
      {previewImage &&
        createPortal(
          <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4 animate-fade-in overflow-hidden">
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white/10 rounded-full px-3 py-1.5 backdrop-blur-md border border-white/10 mr-4">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setZoomLevel(Math.max(1, zoomLevel - 0.5))}
                  className="w-8 h-8 text-white hover:bg-white/20"
                >
                  <Search className="w-4 h-4" />
                </Button>
                <span className="text-xs font-mono text-white w-12 text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setZoomLevel(Math.min(4, zoomLevel + 0.5))}
                  className="w-8 h-8 text-white hover:bg-white/20"
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="bg-white/10 hover:bg-white/20 text-white rounded-full w-10 h-10"
                onClick={() => {
                  setPreviewImage(null);
                  setZoomLevel(1);
                }}
              >
                <X className="w-6 h-6" />
              </Button>
            </div>

            <div className="w-full h-full flex items-center justify-center overflow-auto p-12 custom-scrollbar">
              <div
                className="transition-transform duration-200 ease-out cursor-grab active:cursor-grabbing"
                style={{ transform: `scale(${zoomLevel})` }}
              >
                <img
                  src={previewImage.url}
                  alt="Deep Zoom Preview"
                  className="max-w-[92vw] sm:max-w-[70vw] max-h-[76vh] sm:max-h-[80vh] shadow-2xl rounded-sm ring-1 ring-white/20 object-contain"
                />
              </div>
            </div>

            <div className="absolute bottom-8 bg-black/60 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 flex flex-col items-center">
              <p className="text-white font-semibold text-sm capitalize">
                {previewImage.type.replace(/_/g, " ")}
              </p>
              <p className="text-white/60 text-[10px]">
                Use mouse wheel or buttons to zoom • Drag to pan
              </p>
            </div>
          </div>,
          document.body,
        )}

      <ConfirmDialog
        open={showAuthenticatorResetConfirm}
        title="Reset this user's authenticator?"
        description={
          selectedUser
            ? `Clear the authenticator app enrolled for ${selectedUser.email}. They will scan a new QR code the next time they sign in. Only do this after verifying the request through your support process.`
            : ""
        }
        confirmText="Reset Authenticator"
        cancelText="Cancel"
        destructive
        isLoading={actionLoading}
        onCancel={() => setShowAuthenticatorResetConfirm(false)}
        onConfirm={handleSuperAdminAuthenticatorReset}
      />
    </div>
  );
}
