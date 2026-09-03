import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
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
  runVehicleOcrVerification,
  type VehicleOcrVerificationResult,
} from "@/lib/vehicleOcr";
import { Button } from "@/components/ui/button";
import AdminSectionTabs from "@/components/AdminSectionTabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Car,
  CheckCircle,
  Eye,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

interface PendingCar {
  id: string;
  plate_number: string;
  mileage: number | null;
  price_per_day: number;
  location: string | null;
  additional_info: string | null;
  status: string;
  contact_number: string | null;
  created_at: string;
  registration_expiry: string | null;
  ctpl_expiry: string | null;
  comprehensive_insurance_expiry: string | null;
  insurer_rental_use_confirmed: boolean;
  insurance_verification_status: string;
  car_models: {
    name: string;
    body_type: string;
    seats: number;
    fuel_type: string;
    car_brands: { name: string };
  };
  car_images: { id: string; storage_path: string; is_primary: boolean }[];
  car_documents: {
    id: string;
    document_type: string;
    storage_path: string;
    provenance_status: string;
    provenance_source: string | null;
    provenance_summary: string | null;
    ai_suspicion_score: number | null;
    ai_detector_name: string | null;
    ai_detector_version: string | null;
    review_flag: string;
    review_reason: string | null;
    created_at: string;
  }[];
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    driver_license: string | null;
    national_id: string | null;
    address: string | null;
  };
}

const VEHICLE_VERIFICATION_DOCUMENT_TYPES = [
  "or",
  "or_front",
  "or_back",
  "cr",
  "cr_front",
  "cr_back",
  "orcr",
];

const isVehicleVerificationDocument = (documentType: string) =>
  VEHICLE_VERIFICATION_DOCUMENT_TYPES.includes(documentType.toLowerCase());

const formatDocumentType = (documentType: string) => {
  const normalized = documentType.toLowerCase();
  if (normalized === "or") return "Official Receipt (OR)";
  if (normalized === "or_front") return "Official Receipt (OR) - Front";
  if (normalized === "or_back") return "Official Receipt (OR) - Back";
  if (normalized === "cr") return "Certificate of Registration (CR)";
  if (normalized === "cr_front") return "Certificate of Registration (CR) - Front";
  if (normalized === "cr_back") return "Certificate of Registration (CR) - Back";
  if (normalized === "orcr") return "ORCR Document";
  return documentType;
};

const getOwnerName = (profile: PendingCar["profiles"]) =>
  (
    profile.full_name ||
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
  ).trim();

const isPdfStoragePath = (path: string) => path.toLowerCase().endsWith(".pdf");

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

const getDocumentProvenanceSummary = (documents: PendingCar["car_documents"]) => ({
  total_documents: documents.length,
  c2pa_signal_count: documents.filter(
    (doc) => doc.provenance_status === "credential_present",
  ).length,
  missing_c2pa_count: documents.filter(
    (doc) => doc.provenance_status === "credential_missing",
  ).length,
  manual_review_count: documents.filter(
    (doc) => doc.review_flag === "needs_admin_review",
  ).length,
});

const getLatestRentalAgreement = (documents: PendingCar["car_documents"]) =>
  documents
    .filter(
      (document) => document.document_type?.toLowerCase() === "rental_agreement",
    )
    .slice()
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    )[0];

export default function AdminVehicleApprovalPage() {
  const { user: adminUser, can } = useAuth();
  const canReview = can("vehicles.review");
  const canDelete = can("vehicles.delete");
  const [cars, setCars] = useState<PendingCar[]>([]);
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PendingCar | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [ocrRunKey, setOcrRunKey] = useState(0);
  const [ocrStatus, setOcrStatus] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const [ocrProgress, setOcrProgress] = useState({
    documentType: "",
    status: "",
    progress: 0,
  });
  const [ocrResult, setOcrResult] =
    useState<VehicleOcrVerificationResult | null>(null);
  const [ocrError, setOcrError] = useState("");
  const [manualOcrOverride, setManualOcrOverride] = useState(false);
  const [piiLoading, setPiiLoading] = useState(false);
  const [decryptedOwnerPii, setDecryptedOwnerPii] = useState({
    driver_license: null as string | null,
    national_id: null as string | null,
  });
  const [searchParams] = useSearchParams();
  const initialTab =
    (searchParams.get("tab") as "pending" | "active") || "pending";
  const [activeTab, setActiveTab] = useState<"pending" | "active">(initialTab);

  useEffect(() => {
    if (!selected) {
      setDecryptedOwnerPii({ driver_license: null, national_id: null });
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
        console.warn("Unable to decrypt owner PII:", error.message);
        return null;
      }
      return data;
    };

    const loadOwnerPii = async () => {
      setPiiLoading(true);
      try {
        const [driverLicense, nationalId] = await Promise.all([
          decryptField(selected.profiles.driver_license),
          decryptField(selected.profiles.national_id),
        ]);

        if (isMounted) {
          setDecryptedOwnerPii({
            driver_license: driverLicense,
            national_id: nationalId,
          });
        }
      } finally {
        if (isMounted) setPiiLoading(false);
      }
    };

    void loadOwnerPii();

    return () => {
      isMounted = false;
    };
  }, [selected]);

  const displayPii = (rawValue: string | null, decryptedValue: string | null) => {
    if (piiLoading) return "Decrypting...";
    if (decryptedValue) return decryptedValue;
    if (rawValue && !rawValue.startsWith("pgp:")) return rawValue;
    if (rawValue?.startsWith("pgp:")) return "Encrypted value unavailable";
    return "Not provided";
  };

  const fetchCars = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cars")
        .select(
          "*, car_models(name, body_type, seats, fuel_type, car_brands(name)), car_images(*), car_documents(*), profiles!cars_owner_id_fkey(id, full_name, email, phone, first_name, last_name, driver_license, national_id, address)",
        )
        .in(
          "status",
          activeTab === "pending" ? ["pending"] : ["approved", "active"],
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (data) {
        const typedCars = data as unknown as PendingCar[];
        setCars(typedCars);
        setDocumentUrls(
          await createPrivateStorageUrlMap(
            "vehicle-private-documents",
            typedCars.flatMap((car) =>
              car.car_documents
                .map((document) => document.storage_path)
                .filter((path) => !path.startsWith("http")),
            ),
            "vehicle-documents",
          ),
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load pending vehicles");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchCars();
  }, [activeTab, fetchCars]);

  const getUrl = useCallback((bucket: string, path: string) => {
    // backwards compat: if path is already a full URL (old entries stored full URL), return directly
    if (path.startsWith("http")) return path;
    if (bucket === "vehicle-private-documents") return documentUrls[path] ?? "";
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }, [documentUrls]);

  const sendVehicleDecisionEmail = async (
    target: PendingCar,
    status: "approved" | "rejected" | "pending",
  ) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return "not_attempted";
    try {
      const response = await fetch("/api/send-vehicle-decision-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ carId: target.id, status }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        deliveryState?: string;
      };
      return body.deliveryState ?? "unknown";
    } catch (emailError) {
      console.warn("Vehicle decision email was not delivered", emailError);
      return "failed";
    }
  };

  const showVehicleEmailWarning = (state: string, action: string) => {
    if (state === "not_configured") {
      toast.warning(`${action}, but email is not configured yet.`);
    } else if (state !== "sent") {
      toast.warning(`${action}, but the notification email was not delivered.`);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const runOcr = async () => {
      if (!selected) {
        setOcrStatus("idle");
        setOcrResult(null);
        setOcrError("");
        setOcrProgress({ documentType: "", status: "", progress: 0 });
        return;
      }

      const documents = selected.car_documents
        .filter((document) =>
          isVehicleVerificationDocument(document.document_type),
        )
        .map((document) => ({
          type: formatDocumentType(document.document_type),
          url: getUrl("vehicle-private-documents", document.storage_path),
        }));

      setOcrStatus("running");
      setOcrResult(null);
      setOcrError("");
      setOcrProgress({
        documentType: documents[0]?.type || "Vehicle documents",
        status: documents.length > 0 ? "starting OCR engine" : "no documents found",
        progress: 0,
      });

      try {
        const result = await runVehicleOcrVerification({
          documents,
          expected: {
            plateNumber: selected.plate_number,
            ownerName: getOwnerName(selected.profiles),
            brand: selected.car_models.car_brands.name,
            model: selected.car_models.name,
          },
          onProgress: (progress) => {
            if (!cancelled) setOcrProgress(progress);
          },
        });

        if (!cancelled) {
          setOcrResult(result);
          setOcrStatus("done");
        }
      } catch (error) {
        if (!cancelled) {
          setOcrStatus("error");
          setOcrError(
            error instanceof Error
              ? error.message
              : "Unable to read the vehicle documents.",
          );
        }
      }
    };

    runOcr();

    return () => {
      cancelled = true;
    };
  }, [getUrl, ocrRunKey, selected]);

  const handleApprove = async () => {
    if (!selected || !adminUser) return;
    const ocrAccepted = ocrResult?.passed || manualOcrOverride;
    if (!ocrAccepted) {
      toast.error("Review OCR warnings or enable manual review override.");
      return;
    }

    setActionLoading(true);
    const { error } = await supabase
      .from("cars")
      .update({
        status: "approved",
        rejection_reason: null,
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", selected.id);
    if (!error) {
      const { error: documentReviewError } = await supabase
        .from("car_documents")
        .update({
          review_flag: "approved_after_review",
          review_reason: "Vehicle documents approved by admin after manual review.",
          reviewed_by: adminUser.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("car_id", selected.id);
      if (documentReviewError) {
        console.warn(
          "Unable to stamp vehicle document review:",
          documentReviewError.message,
        );
      }
      await supabase
        .from("notifications")
        .insert({
          user_id: selected.profiles.id,
          title: "Vehicle Approved!",
          message: `Your ${selected.car_models.car_brands.name} ${selected.car_models.name} has been approved and is now listed.`,
          type: "success",
          link: "/my-vehicles",
        });
      showVehicleEmailWarning(
        await sendVehicleDecisionEmail(selected, "approved"),
        "Vehicle approved",
      );
      await supabase
        .from("audit_log")
        .insert({
          user_id: adminUser.id,
          action: "admin_approved_vehicle",
          entity_type: "car",
          entity_id: selected.id,
          details: {
            plate: selected.plate_number,
            model: selected.car_models.name,
            ocr_passed: ocrResult?.passed ?? false,
            ocr_override_used: !ocrResult?.passed && manualOcrOverride,
            ocr_checks:
              ocrResult?.checks.map((check) => ({
                field: check.id,
                expected: check.expected,
                status: check.status,
              })) ?? [],
            provenance: getDocumentProvenanceSummary(selected.car_documents),
          },
        });
      toast.success("Vehicle approved and listed!");
      setSelected(null);
      setManualOcrOverride(false);
      fetchCars();
    }
    setActionLoading(false);
  };

  const handleReject = async () => {
    if (!selected || !adminUser || !rejectionReason.trim()) {
      toast.error("Provide a reason");
      return;
    }
    setActionLoading(true);
    const { error } = await supabase
      .from("cars")
      .update({ status: "rejected", rejection_reason: rejectionReason })
      .eq("id", selected.id);
    if (!error) {
      const { error: documentReviewError } = await supabase
        .from("car_documents")
        .update({
          review_flag: "rejected_after_review",
          review_reason: rejectionReason.trim(),
          reviewed_by: adminUser.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("car_id", selected.id);
      if (documentReviewError) {
        console.warn(
          "Unable to stamp vehicle document review:",
          documentReviewError.message,
        );
      }
      await supabase
        .from("notifications")
        .insert({
          user_id: selected.profiles.id,
          title: "Vehicle Rejected",
          message: `Your ${selected.car_models.car_brands.name} ${selected.car_models.name} was rejected. Reason: ${rejectionReason}`,
          type: "error",
          link: "/my-vehicles",
        });
      showVehicleEmailWarning(
        await sendVehicleDecisionEmail(selected, "rejected"),
        "Vehicle rejected",
      );
      await supabase
        .from("audit_log")
        .insert({
          user_id: adminUser.id,
          action: "admin_rejected_vehicle",
          entity_type: "car",
          entity_id: selected.id,
          details: {
            reason: rejectionReason,
            ocr_passed: ocrResult?.passed ?? false,
            ocr_checks:
              ocrResult?.checks.map((check) => ({
                field: check.id,
                expected: check.expected,
                status: check.status,
              })) ?? [],
            provenance: getDocumentProvenanceSummary(selected.car_documents),
          },
        });
      toast.success("Vehicle rejected");
      setSelected(null);
      setRejectionReason("");
      setShowReject(false);
      setManualOcrOverride(false);
      fetchCars();
    }
    setActionLoading(false);
  };

  const handleRevokeApproval = async () => {
    if (!selected || !adminUser || !revokeReason.trim()) {
      toast.error("Provide a revoke reason");
      return;
    }
    setActionLoading(true);
    const { error } = await supabase
      .from("cars")
      .update({ status: "pending", rejection_reason: revokeReason })
      .eq("id", selected.id);
    if (!error) {
      await supabase
        .from("notifications")
        .insert({
          user_id: selected.profiles.id,
          title: "Vehicle Approval Revoked",
          message: `Your ${selected.car_models.car_brands.name} ${selected.car_models.name} was moved back to pending review. Reason: ${revokeReason}`,
          type: "warning",
          link: "/my-vehicles",
        });
      showVehicleEmailWarning(
        await sendVehicleDecisionEmail(selected, "pending"),
        "Vehicle returned to review",
      );
      await supabase
        .from("audit_log")
        .insert({
          user_id: adminUser.id,
          action: "admin_revoked_vehicle",
          entity_type: "car",
          entity_id: selected.id,
          details: { plate: selected.plate_number, reason: revokeReason },
        });
      toast.success("Vehicle reverted to pending.");
      setSelected(null);
      setShowRevoke(false);
      setRevokeReason("");
      setManualOcrOverride(false);
      fetchCars();
    }
    setActionLoading(false);
  };

  const handleDeleteVehicle = async () => {
    if (!selected || !adminUser) return;
    setActionLoading(true);
    const { error } = await supabase
      .from("cars")
      .delete()
      .eq("id", selected.id);
    if (!error) {
      await supabase
        .from("audit_log")
        .insert({
          user_id: adminUser.id,
          action: "admin_deleted_vehicle",
          entity_type: "car",
          entity_id: selected.id,
          details: { plate: selected.plate_number },
        });
      toast.success("Vehicle deleted successfully.");
      setSelected(null);
      setShowDeleteConfirm(false);
      setManualOcrOverride(false);
      fetchCars();
    } else {
      toast.error("Failed to delete vehicle", { description: error.message });
    }
    setActionLoading(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Vehicle Management
        </h1>
        <p className="text-muted-foreground mt-1">
          Review pending car approvals and monitor active cars.
        </p>
      </div>

      <AdminSectionTabs
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Vehicle management view"
        tabs={[
          { value: "pending", label: "Pending approvals" },
          { value: "active", label: "Active cars" },
        ]}
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : cars.length === 0 ? (
        <div className="text-center py-20">
          <Car className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold">
            No {activeTab === "pending" ? "pending car approvals" : "active cars"}
          </h3>
          <p className="text-muted-foreground text-sm">
            Waiting for new vehicle submissions.
          </p>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Plate</TableHead>
                <TableHead>Price/Day</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cars.map((car) => (
                <TableRow
                  key={car.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    setSelected(car);
                    setShowReject(false);
                    setRejectionReason("");
                    setShowRevoke(false);
                    setRevokeReason("");
                    setManualOcrOverride(false);
                  }}
                >
                  <TableCell className="font-medium">
                    {car.car_models.car_brands.name} {car.car_models.name}
                  </TableCell>
                  <TableCell>
                    {car.profiles.full_name || car.profiles.email}
                  </TableCell>
                  <TableCell className="font-mono">
                    {car.plate_number}
                  </TableCell>
                  <TableCell>
                    ₱{Number(car.price_per_day).toLocaleString()}
                  </TableCell>
                  <TableCell className="capitalize">{car.status}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Vehicle Detail Modal */}
      {selected &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 py-6 sm:items-center"
            onClick={() => {
              setSelected(null);
              setManualOcrOverride(false);
            }}
          >
            <div
              className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[calc(100vh-2rem)] sm:max-h-[90vh] flex flex-col animate-scale-in overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-border flex items-center justify-between bg-background z-10 shrink-0">
                <h2 className="text-xl font-bold">Vehicle Review</h2>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setSelected(null);
                    setManualOcrOverride(false);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
              {/* Vehicle Info */}
              <div>
                <h3 className="font-semibold text-lg">
                  {selected.car_models.car_brands.name}{" "}
                  {selected.car_models.name}
                </h3>
                <div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Body Type:</span>{" "}
                    <span className="capitalize font-medium">
                      {selected.car_models.body_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Seats:</span>{" "}
                    <span className="font-medium">
                      {selected.car_models.seats}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fuel:</span>{" "}
                    <span className="capitalize font-medium">
                      {selected.car_models.fuel_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Plate:</span>{" "}
                    <span className="font-mono font-medium">
                      {selected.plate_number}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mileage:</span>{" "}
                    <span className="font-medium">
                      {selected.mileage
                        ? `${selected.mileage.toLocaleString()} km`
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Price/Day:</span>{" "}
                    <span className="font-medium">
                      ₱{Number(selected.price_per_day).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location:</span>{" "}
                    <span className="font-medium">
                      {selected.location || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Contact:</span>{" "}
                    <span className="font-medium">
                      {selected.contact_number ||
                        selected.profiles.phone ||
                        "N/A"}
                    </span>
                  </div>
                </div>
                {selected.additional_info && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Additional: {selected.additional_info}
                  </p>
                )}
              </div>

              {/* Car Images */}
              {selected.car_images.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Car Images</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {selected.car_images.map((img) => (
                      <a
                        key={img.id}
                        href={getUrl("vehicle-documents", img.storage_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={getUrl("vehicle-documents", img.storage_path)}
                          alt="Car"
                          className="w-full h-24 object-cover rounded-lg border hover:ring-2 hover:ring-primary cursor-pointer"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className={`rounded-lg border p-4 ${selected.registration_expiry && selected.ctpl_expiry && selected.insurer_rental_use_confirmed ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                <h4 className="font-semibold">Registration & insurance review</h4>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <p>Registration expiry: <strong>{selected.registration_expiry || "Missing"}</strong></p>
                  <p>CTPL expiry: <strong>{selected.ctpl_expiry || "Missing"}</strong></p>
                  <p>Comprehensive expiry: <strong>{selected.comprehensive_insurance_expiry || "Not supplied"}</strong></p>
                  <p>Rental use disclosed to insurer: <strong>{selected.insurer_rental_use_confirmed ? "Confirmed by lister" : "Not confirmed"}</strong></p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">SafeDrive records and reviews these declarations but does not represent that a private policy covers peer-to-peer rental. Approval is blocked if registration or CTPL is expired or rental-use disclosure is not confirmed; missing comprehensive cover remains an explicit warning.</p>
              </div>

              {/* OR/CR documents (admin only) */}
              {selected.car_documents.filter((d) =>
                isVehicleVerificationDocument(d.document_type),
              ).length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">
                    OR/CR Documents (Admin Only)
                  </h4>
                  {selected.car_documents
                    .filter((d) =>
                      isVehicleVerificationDocument(d.document_type),
                    )
                    .map((doc) => (
                      <div key={doc.id} className="inline-block mr-3 mb-3 align-top">
                        <p className="text-xs text-muted-foreground mb-1">
                          {formatDocumentType(doc.document_type)}
                        </p>
                        <div className="mb-1 flex flex-wrap gap-1">
                          {(() => {
                            const badge = getProvenanceBadge(
                              asProvenanceStatus(doc.provenance_status),
                            );
                            return (
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            );
                          })()}
                          {asReviewFlag(doc.review_flag) !== "none" &&
                            (() => {
                              const badge = getReviewFlagBadge(
                                asReviewFlag(doc.review_flag),
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
                        <a
                          href={getUrl("vehicle-private-documents", doc.storage_path)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          {isPdfStoragePath(doc.storage_path) ? (
                            <div className="w-48 h-32 rounded-lg border bg-muted/40 hover:ring-2 hover:ring-primary cursor-pointer flex flex-col items-center justify-center gap-2 text-center p-4">
                              <FileText className="w-8 h-8 text-primary" />
                              <span className="text-sm font-medium">Open PDF</span>
                              <span className="text-[11px] text-muted-foreground">
                                Preview unavailable in card view
                              </span>
                            </div>
                          ) : (
                            <img
                              src={getUrl("vehicle-private-documents", doc.storage_path)}
                              alt={formatDocumentType(doc.document_type)}
                              className="w-48 h-32 object-cover rounded-lg border hover:ring-2 hover:ring-primary cursor-pointer"
                            />
                          )}
                        </a>
                        <p className="mt-1 max-w-48 text-[11px] text-muted-foreground leading-snug">
                          {doc.provenance_summary ||
                            "No provenance scan summary is stored for this document."}
                        </p>
                      </div>
                    ))}
                </div>
              )}

              {/* Rental Agreement: a listing can retain older uploads, but only the newest agreement is reviewable. */}
              {getLatestRentalAgreement(selected.car_documents) && (
                <div>
                  <h4 className="font-semibold mb-2">Rental Agreement</h4>
                  {(() => {
                    const doc = getLatestRentalAgreement(selected.car_documents)!;
                    return (
                      <div key={doc.id} className="inline-block align-top">
                        <div className="mb-1 flex flex-wrap gap-1">
                          {(() => {
                            const badge = getProvenanceBadge(
                              asProvenanceStatus(doc.provenance_status),
                            );
                            return (
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            );
                          })()}
                          {asReviewFlag(doc.review_flag) !== "none" &&
                            (() => {
                              const badge = getReviewFlagBadge(
                                asReviewFlag(doc.review_flag),
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
                        <a
                          href={getUrl("vehicle-private-documents", doc.storage_path)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block"
                        >
                          <div className="w-48 h-32 rounded-lg border bg-muted/40 hover:ring-2 hover:ring-primary cursor-pointer flex flex-col items-center justify-center gap-2 text-center p-4">
                            <FileText className="w-8 h-8 text-primary" />
                            <span className="text-sm font-medium">Open Rental Agreement</span>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              Review document <ExternalLink className="w-3 h-3" />
                            </span>
                          </div>
                        </a>
                        <p className="mt-1 max-w-48 text-[11px] text-muted-foreground leading-snug">
                          {doc.provenance_summary ||
                            "No provenance scan summary is stored for this document."}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Automated OCR verification */}
              <div
                className={`p-4 rounded-lg border ${
                  ocrResult?.passed
                    ? "bg-green-500/10 border-green-500/30"
                    : ocrStatus === "done" || ocrStatus === "error"
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-muted/50 border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold flex items-center gap-2">
                      {ocrResult?.passed ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : ocrStatus === "running" ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      )}
                      Automated OCR Verification
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      The system reads the OR/CR and compares it with the submitted vehicle fields.
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      This scanner is an assistive OCR checker inside SafeDrive. It helps cross-check text quickly, but it does not replace manual admin validation and it is not yet using a separate external authenticity API.
                    </p>
                    {selected.car_documents.some(
                      (doc) =>
                        isVehicleVerificationDocument(doc.document_type) &&
                        isPdfStoragePath(doc.storage_path),
                    ) && (
                      <p className="text-xs text-amber-600 mt-2">
                        Some verification documents are PDFs. OCR may be less reliable, so manual review override is available.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setOcrRunKey((key) => key + 1)}
                    disabled={ocrStatus === "running"}
                    className="gap-2 shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        ocrStatus === "running" ? "animate-spin" : ""
                      }`}
                    />
                    {ocrStatus === "running" ? "Processing..." : "Run Again"}
                  </Button>
                </div>

                {ocrStatus === "running" && (
                  <div className="mt-4 space-y-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                    <p className="text-sm font-medium text-primary">
                      Reading uploaded OR/CR documents. Please wait before taking action.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      The first check may take a few seconds while SafeDrive starts its OCR engine. Later checks reuse it.
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {ocrProgress.documentType || "Vehicle document"}:{" "}
                        {ocrProgress.status || "reading"}
                      </span>
                      <span className="font-medium">
                        {Math.round(Math.min(1, ocrProgress.progress) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-background overflow-hidden border">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: `${Math.round(
                            Math.min(1, ocrProgress.progress) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {ocrStatus === "error" && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-4">
                    OCR failed: {ocrError}
                  </p>
                )}

                {ocrStatus === "done" && ocrResult && (
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          ocrResult.passed
                            ? "bg-green-500/15 text-green-600"
                            : "bg-red-500/15 text-red-600"
                        }`}
                      >
                        {ocrResult.passed ? "Correct" : "Not Correct"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Checked {new Date(ocrResult.checkedAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2">
                      {ocrResult.checks.map((check) => (
                        <div
                          key={check.id}
                          className="flex items-start gap-2 rounded-md bg-background/70 border border-border p-2"
                        >
                          {check.status === "match" ? (
                            <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">
                              {check.label}
                            </p>
                            <p className="text-sm font-medium break-words">
                              {check.expected || "N/A"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {ocrResult.documents.length === 0 ? (
                        <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          No OR/CR document was found for OCR.
                        </p>
                      ) : (
                        ocrResult.documents.map((document) => (
                          <div
                            key={document.type}
                            className="flex items-center justify-between gap-3 text-xs rounded-md bg-background/70 border border-border p-2"
                          >
                            <span className="flex items-center gap-2">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              {document.type}
                            </span>
                            <span
                              className={
                                document.status === "read"
                                  ? "text-green-600"
                                  : "text-red-600"
                              }
                            >
                              {document.status === "read"
                                ? `${document.textLength} characters read`
                                : document.error || "Failed"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    {ocrResult.rawText && (
                      <details className="rounded-md bg-background/70 border border-border p-3">
                        <summary className="text-xs font-medium cursor-pointer">
                          View OCR Text
                        </summary>
                        <pre className="mt-3 text-xs whitespace-pre-wrap break-words max-h-44 overflow-auto custom-scrollbar">
                          {ocrResult.rawText}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>

              {/* Owner Info for cross-checking */}
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <h4 className="font-semibold mb-2">
                  Owner Verification (Cross-Check)
                </h4>
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>{" "}
                    <span className="font-medium">
                      {selected.profiles.full_name ||
                        `${selected.profiles.first_name || ""} ${selected.profiles.last_name || ""}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>{" "}
                    <span className="font-medium">
                      {selected.profiles.email}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>{" "}
                    <span className="font-medium">
                      {selected.profiles.phone || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Address:</span>{" "}
                    <span className="font-medium">
                      {selected.profiles.address || "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Driver's License:
                    </span>{" "}
                    <span className="font-medium">
                      {displayPii(
                        selected.profiles.driver_license,
                        decryptedOwnerPii.driver_license,
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">National ID:</span>{" "}
                    <span className="font-medium">
                      {displayPii(
                        selected.profiles.national_id,
                        decryptedOwnerPii.national_id,
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rejection reason */}
              {showReject && (
                <div className="space-y-2">
                  <Label>Rejection Reason *</Label>
                  <Input
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Reason for rejecting this vehicle..."
                  />
                </div>
              )}
              {showRevoke && (
                <div className="space-y-2">
                  <Label>Revoke Note *</Label>
                  <Input
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="Reason for moving this vehicle back to pending review..."
                  />
                </div>
              )}

              {activeTab === "pending" && !ocrResult?.passed && (
                <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={manualOcrOverride}
                    onChange={(e) => setManualOcrOverride(e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-amber-800">
                      Manual review override
                    </span>
                    <span className="block text-amber-700/90 text-xs mt-1">
                      Use this when the uploaded documents are visibly correct but OCR could not read them reliably.
                    </span>
                  </span>
                </label>
              )}

              {/* Actions */}
              {activeTab === "pending" && canReview && (
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
                  <Button
                    onClick={handleApprove}
                    disabled={
                      actionLoading ||
                      ocrStatus === "running" ||
                      (!ocrResult?.passed && !manualOcrOverride)
                    }
                    className="gap-2"
                  >
                    {actionLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {ocrResult?.passed ? "Approve" : "Approve with Manual Review"}
                  </Button>
                  {!showReject ? (
                    <Button
                      variant="destructive"
                      onClick={() => setShowReject(true)}
                      className="gap-2"
                    >
                      <XCircle className="w-4 h-4" /> Reject
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
              {activeTab === "pending" && !ocrResult?.passed && (
                <p className="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
                  <AlertCircle className="w-2.5 h-2.5" />
                  OCR warning detected. You can still approve after manual review by enabling the override above.
                </p>
              )}
              {activeTab === "active" && (canReview || canDelete) && (
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap">
                  {canReview && !showRevoke ? (
                    <Button
                      variant="outline"
                      onClick={() => setShowRevoke(true)}
                      disabled={actionLoading}
                      className="gap-2 text-amber-500 hover:text-amber-500"
                    >
                      <XCircle className="w-4 h-4" />
                      Revoke
                    </Button>
                  ) : null}
                  {canReview && showRevoke ? (
                    <Button
                      variant="outline"
                      onClick={handleRevokeApproval}
                      disabled={actionLoading || !revokeReason.trim()}
                      className="gap-2 text-amber-500 hover:text-amber-500"
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                      Confirm Revoke
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      variant="destructive"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={actionLoading}
                      className="gap-2"
                    >
                      {actionLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                      Delete
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Permanently delete this vehicle?"
        description={
          selected
            ? `Delete ${selected.car_models.car_brands.name} ${selected.car_models.name} (${selected.plate_number}) permanently? This cannot be undone.`
            : ""
        }
        confirmText="Delete Vehicle"
        destructive
        isLoading={actionLoading}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteVehicle}
      />
    </div>
  );
}
