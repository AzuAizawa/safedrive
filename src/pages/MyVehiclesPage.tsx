import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  inspectContentProvenance,
  type ContentProvenanceResult,
} from "@/lib/contentProvenance";
import { getCurrentSubscription } from "@/lib/subscriptions";
import { uploadFile } from "@/lib/uploadUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Car,
  CheckCircle,
  ImageIcon,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { CarBrand, CarModel } from "@/types/database";
import {
  PLATE_NUMBER_PATTERN,
  PLATE_NUMBER_HINT,
  validatePlateNumber,
  validateListingPrice,
} from "@/lib/vehicleValidation";

const MAX_LISTING_PRICE = 100000;
const MAX_SECURITY_DEPOSIT = 100000;
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_PDF_TYPES = ["application/pdf"];
const VEHICLE_REGION_OPTIONS = [
  "Metro Manila",
  "Metro Cebu",
  "Metro Davao",
  "Northern Luzon",
  "Central Luzon",
  "Southern Luzon",
  "Western Visayas",
  "Central Visayas",
  "Eastern Visayas",
  "Northern Mindanao",
  "Southern Mindanao",
] as const;

const FUEL_CATEGORY_OPTIONS = {
  Gasoline: [
    "Regular (91 RON)",
    "Premium (95 - 97 RON)",
    "Racing Ultra Premium",
  ],
  Diesel: [
    "Standard Diesel",
    "Premium Diesel",
    "Euro 2 Diesel",
  ],
  "Electrified & Alternative Fuels": [
    "Hybrid",
    "Plug-in Hybrid",
    "Battery Electric",
    "AutoLPG",
  ],
} as const;

interface VehicleRow {
  id: string;
  plate_number: string;
  mileage: number | null;
  price_per_day: number;
  security_deposit_amount: number;
  location: string | null;
  fuel_category: string | null;
  fuel_subtype: string | null;
  gps_available: boolean;
  contact_number: string | null;
  additional_info: string | null;
  registration_expiry: string | null;
  ctpl_expiry: string | null;
  comprehensive_insurance_expiry: string | null;
  insurer_rental_use_confirmed: boolean;
  insurance_verification_status: string;
  status: string;
  car_models: { name: string; body_type: string; car_brands: { name: string } };
}

const statusBadge: Record<string, { label: string; color: string }> = {
  pending: {
    label: "Pending",
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
  },
  approved: {
    label: "Approved",
    color: "text-green-600 bg-green-50 dark:bg-green-950/30",
  },
  active: {
    label: "Active",
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
  },
  rejected: {
    label: "Rejected",
    color: "text-red-600 bg-red-50 dark:bg-red-950/30",
  },
  inactive: { label: "Inactive", color: "text-muted-foreground bg-muted" },
};

const formatModelLabel = (model: CarModel) =>
  `${model.name} (${model.body_type}, ${model.seats} seats)`;

const normalizeVehicleRegion = (value: string | null) => {
  if (!value) return "";

  const normalized = value.trim().toLowerCase();
  const matchedRegion = VEHICLE_REGION_OPTIONS.find(
    (region) =>
      normalized === region.toLowerCase() ||
      normalized.startsWith(`${region.toLowerCase()} -`) ||
      normalized.includes(region.toLowerCase()),
  );

  return matchedRegion ?? "";
};

const parseStoredLocation = (location: string | null) => {
  if (!location) {
    return {
      region: "",
      city: "",
      specificLocation: "",
    };
  }

  const parts = location
    .split(" - ")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedRegion = normalizeVehicleRegion(location);
  const region = normalizedRegion || parts[0] || "";
  const city =
    normalizedRegion && parts[0] === normalizedRegion
      ? parts[1] ?? ""
      : normalizedRegion
        ? parts[0] ?? ""
        : parts[1] ?? "";
  const specificLocation =
    normalizedRegion && parts[0] === normalizedRegion
      ? parts.slice(2).join(" - ")
      : normalizedRegion
        ? parts.slice(1).join(" - ")
        : parts.slice(2).join(" - ");

  return {
    region,
    city,
    specificLocation,
  };
};

const validateUploadFile = (
  file: File,
  allowedTypes: string[],
  label: string,
) => {
  if (!allowedTypes.includes(file.type)) {
    const expectedLabel =
      allowedTypes === ALLOWED_PDF_TYPES
        ? "PDF"
        : "WEBP, JPG, or PNG image";
    toast.error(`Invalid ${label} file`, {
      description: `Please upload a ${expectedLabel} file.`,
    });
    return false;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    toast.error(`${label} file is too large`, {
      description: "Each upload must be 10 MB or smaller.",
    });
    return false;
  }

  return true;
};

const sanitizePhilippineMobileNumber = (value: string) =>
  value.replace(/\D/g, "").slice(0, 11);

const sanitizeVehicleRegionInput = (value: string) =>
  value.replace(/[0-9]/g, "");

const isMissingProvenanceColumnError = (message: string) =>
  message.toLowerCase().includes("provenance") ||
  message.toLowerCase().includes("review_flag") ||
  message.toLowerCase().includes("ai_suspicion");

const hashFileSha256 = async (file: File) => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};


export default function MyVehiclesPage() {
  const { user, profile } = useAuth();
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [brands, setBrands] = useState<CarBrand[]>([]);
  const [models, setModels] = useState<CarModel[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeSub, setActiveSub] = useState<{
    additional_slots: number;
    plan_type: string;
    end_date: string | null;
  } | null>(null);

  const [editVehicle, setEditVehicle] = useState<VehicleRow | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editSecurityDeposit, setEditSecurityDeposit] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editSpecificLocation, setEditSpecificLocation] = useState("");
  const [editFuelCategory, setEditFuelCategory] = useState("");
  const [editFuelSubtype, setEditFuelSubtype] = useState("");
  const [editGpsAvailable, setEditGpsAvailable] = useState(false);
  const [editContact, setEditContact] = useState("");
  const [editAdditionalInfo, setEditAdditionalInfo] = useState("");
  const [editRegistrationExpiry, setEditRegistrationExpiry] = useState("");
  const [editCtplExpiry, setEditCtplExpiry] = useState("");
  const [editComprehensiveExpiry, setEditComprehensiveExpiry] = useState("");
  const [editRentalUseConfirmed, setEditRentalUseConfirmed] = useState(false);
  const [editRentalAgreement, setEditRentalAgreement] = useState<File | null>(null);
  const [editCarImages, setEditCarImages] = useState<File[]>([]);
  const [editing, setEditing] = useState(false);
  const [vehicleActionId, setVehicleActionId] = useState<string | null>(null);
  const [deleteTargetVehicle, setDeleteTargetVehicle] = useState<VehicleRow | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");

  const [form, setForm] = useState({
    brand_id: null as string | null,
    model_id: null as string | null,
    plate_number: "",
    mileage: "",
    price_per_day: "",
    security_deposit_amount: "",
    location: "",
    city: "",
    specific_location: "",
    fuel_category: "",
    fuel_subtype: "",
    gps_available: false,
    contact_number: profile?.phone || "",
    manufacturing_year: "",
    additional_info: "",
    registration_expiry: "",
    ctpl_expiry: "",
    comprehensive_insurance_expiry: "",
    insurer_rental_use_confirmed: false,
    rental_agreement: "",
  });
  const [carImages, setCarImages] = useState<File[]>([]);
  const [orFile, setOrFile] = useState<File | null>(null);
  const [orBackFile, setOrBackFile] = useState<File | null>(null);
  const [crFile, setCrFile] = useState<File | null>(null);
  const [crBackFile, setCrBackFile] = useState<File | null>(null);
  const [rentalAgreementFile, setRentalAgreementFile] = useState<File | null>(
    null,
  );
  const [plateCheck, setPlateCheck] = useState<{
    status: "idle" | "checking" | "available" | "taken";
    message: string;
  }>({ status: "idle", message: "" });

  const insertCarDocument = async (
    carId: string,
    documentType: string,
    storagePath: string,
    provenance: ContentProvenanceResult,
    contentSha256?: string | null,
  ) => {
    const { error } = await supabase.from("car_documents").insert({
      car_id: carId,
      document_type: documentType,
      storage_path: storagePath,
      content_sha256: contentSha256 || null,
      ...provenance,
    });

    if (!error) return;

    if (!isMissingProvenanceColumnError(error.message)) {
      throw error;
    }

    console.warn(
      "Vehicle provenance columns are not live yet; saving document without provenance metadata.",
      error.message,
    );
    const { error: fallbackError } = await supabase.from("car_documents").insert({
      car_id: carId,
      document_type: documentType,
      storage_path: storagePath,
    });
    if (fallbackError) throw fallbackError;
  };
  const selectedModel = form.model_id
    ? models.find((model) => model.id === form.model_id) || null
    : null;
  const availableFuelSubtypes = form.fuel_category
    ? [
        ...FUEL_CATEGORY_OPTIONS[
          form.fuel_category as keyof typeof FUEL_CATEGORY_OPTIONS
        ],
      ]
    : [];
  const availableEditFuelSubtypes = editFuelCategory
    ? [
        ...FUEL_CATEGORY_OPTIONS[
          editFuelCategory as keyof typeof FUEL_CATEGORY_OPTIONS
        ],
      ]
    : [];

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cars")
        .select("*, car_models(name, body_type, car_brands(name))")
        .eq("owner_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Fetch vehicles error:", error);
      } else if (data) {
        setVehicles(data as unknown as VehicleRow[]);
      }
    } catch (err) {
      console.error("Unexpected error fetching vehicles:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchBrands = useCallback(async () => {
    const { data } = await supabase
      .from("car_brands")
      .select("*")
      .order("name");
    if (data) setBrands(data);
  }, []);

  const fetchActiveSubscription = useCallback(async () => {
    if (!user) return;
    const data = await getCurrentSubscription(user.id);
    setActiveSub(data ?? null);
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchVehicles();
      fetchBrands();
      fetchActiveSubscription();
    }
  }, [user, fetchActiveSubscription, fetchBrands, fetchVehicles]);

  const fetchModels = async (brandId: string) => {
    const { data } = await supabase
      .from("car_models")
      .select("*")
      .eq("brand_id", brandId)
      .order("name");
    if (data) setModels(data);
  };

  const baseSlots = 5;
  const bonusSlots = activeSub?.additional_slots ?? 0;
  const maxSlots = baseSlots + bonusSlots;
  const canAddMore = vehicles.length < maxSlots;
  const isVerifiedLister = profile?.verified_status === "verified";
  const slotsRemaining = Math.max(maxSlots - vehicles.length, 0);
  const listingBlockedReason = !isVerifiedLister
    ? "Finish account verification first. Only verified users can submit vehicles for admin approval."
    : !canAddMore
      ? `Your current plan already uses all ${maxSlots} available listing slots.`
      : null;
  const filteredVehicles = useMemo(() => {
    const visibleVehicles = vehicles.filter((vehicle) =>
      statusFilter === "all" ? true : vehicle.status === statusFilter,
    );

    return [...visibleVehicles].sort((left, right) => {
      switch (sortOrder) {
        case "price_high":
          return right.price_per_day - left.price_per_day;
        case "price_low":
          return left.price_per_day - right.price_per_day;
        case "brand":
          return `${left.car_models.car_brands.name} ${left.car_models.name}`.localeCompare(
            `${right.car_models.car_brands.name} ${right.car_models.name}`,
          );
        case "oldest":
          return left.plate_number.localeCompare(right.plate_number);
        case "newest":
        default:
          return right.id.localeCompare(left.id);
      }
    });
  }, [sortOrder, statusFilter, vehicles]);
  const isLiveVehicle = (status: string) =>
    status === "approved" || status === "active";

  const normalizePlate = (value: string) => value.trim().toUpperCase();

  const checkPlateNumber = async (plateNumber: string) => {
    const normalized = normalizePlate(plateNumber);
    if (!/^[A-Z]{3} ?-?[0-9]{3,4}$/.test(normalized)) {
      setPlateCheck({ status: "idle", message: "" });
      return;
    }

    setPlateCheck({ status: "checking", message: "Checking plate number..." });
    const { data, error } = await supabase
      .from("cars")
      .select("id")
      .eq("plate_number", normalized)
      .maybeSingle();

    if (error) {
      setPlateCheck({ status: "idle", message: "" });
      return;
    }

    setPlateCheck(
      data
        ? {
            status: "taken",
            message: "This plate number is already registered in SafeDrive.",
          }
        : { status: "available", message: "Plate number is available." },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !form.model_id) return;
    if (plateCheck.status === "taken") {
      toast.error("Duplicate Plate Number", {
        description: "This plate number is already registered in our system.",
      });
      return;
    }

    if (!isVerifiedLister) {
      toast.error("Vehicle listing unavailable", {
        description:
          "Finish your identity verification first, then return here to submit your car for admin review.",
      });
      return;
    }

    const plateError = validatePlateNumber(form.plate_number);
    if (plateError) {
      toast.error("Invalid plate number", { description: plateError });
      return;
    }

    const priceError = validateListingPrice(form.price_per_day);
    if (priceError) {
      toast.error("Invalid listing price", { description: priceError });
      return;
    }
    const pricePerDay = Number(form.price_per_day);

    const securityDepositAmount =
      form.security_deposit_amount === ""
        ? 0
        : Number(form.security_deposit_amount);
    if (
      !Number.isFinite(securityDepositAmount) ||
      securityDepositAmount < 0 ||
      securityDepositAmount > MAX_SECURITY_DEPOSIT
    ) {
      toast.error("Invalid security deposit amount", {
        description: `Security deposit must be between PHP 0 and PHP ${MAX_SECURITY_DEPOSIT.toLocaleString()}.`,
      });
      return;
    }

    if (carImages.length < 1 || carImages.length > 5) {
      toast.error("Please provide between 1 and 5 car images.");
      return;
    }

    if (!orFile || !orBackFile || !crFile || !crBackFile) {
      toast.error("OR and CR front/back photos are required.");
      return;
    }

    if (!rentalAgreementFile) {
      toast.error("Rental Agreement PDF is required.");
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (
      !form.registration_expiry ||
      form.registration_expiry < todayIso ||
      !form.ctpl_expiry ||
      form.ctpl_expiry < todayIso ||
      !form.insurer_rental_use_confirmed
    ) {
      toast.error(
        "Registration and CTPL must be current, and rental-use disclosure must be confirmed with the insurer.",
      );
      return;
    }

    setSubmitting(true);
    const toastId = toast.loading("Saving vehicle details...");
    try {
      const { data: carData, error: carError } = await supabase
        .from("cars")
        .insert({
          owner_id: user.id,
          model_id: form.model_id,
          plate_number: form.plate_number,
          mileage: form.mileage ? parseInt(form.mileage) : null,
          price_per_day: pricePerDay,
          security_deposit_amount: securityDepositAmount,
          location: form.location ? [
            form.location,
            form.city || null,
            form.specific_location || null,
          ].filter(Boolean).join(" - ") : null,
          fuel_category: form.fuel_category || null,
          fuel_subtype: form.fuel_subtype || null,
          gps_available: form.gps_available,
          contact_number: form.contact_number || null,
          additional_info: form.additional_info || null,
          registration_expiry: form.registration_expiry,
          ctpl_expiry: form.ctpl_expiry,
          comprehensive_insurance_expiry:
            form.comprehensive_insurance_expiry || null,
          insurer_rental_use_confirmed: form.insurer_rental_use_confirmed,
          insurance_verification_status: "pending",
        })
        .select()
        .single();

      if (carError) throw carError;

      // Upload car images
      toast.loading("Uploading car images...", { id: toastId });
      for (let i = 0; i < carImages.length; i++) {
        const file = carImages[i];
        const path = `${user.id}/${carData.id}/image_${i}`;
        const result = await uploadFile(file, "vehicle-documents", path);
        if (!result.success) throw new Error(result.error || "Upload failed");

        await supabase.from("car_images").insert({
          car_id: carData.id,
          storage_path: path,  // store relative path, not full URL
          is_primary: i === 0,
        });
      }

      const vehicleDocuments = [
        { file: orFile, type: "or_front", label: "OR front" },
        { file: orBackFile, type: "or_back", label: "OR back" },
        { file: crFile, type: "cr_front", label: "CR front" },
        { file: crBackFile, type: "cr_back", label: "CR back" },
      ];

      for (const document of vehicleDocuments) {
        if (!document.file) continue;
        toast.loading(`Uploading ${document.label}...`, { id: toastId });
        const path = `${user.id}/${carData.id}/${document.type}`;
        const provenance = await inspectContentProvenance(document.file);
        const result = await uploadFile(document.file, "vehicle-private-documents", path);
        if (!result.success) throw new Error(result.error || "Upload failed");

        await insertCarDocument(carData.id, document.type, path, provenance);
      }

      // Upload rental agreement
      if (rentalAgreementFile) {
        toast.loading("Uploading rental agreement...", { id: toastId });
        const path = `${user.id}/${carData.id}/rental_agreement`;
        const provenance = await inspectContentProvenance(rentalAgreementFile);
        const contentSha256 = await hashFileSha256(rentalAgreementFile);
        const result = await uploadFile(
          rentalAgreementFile,
          "vehicle-private-documents",
          path,
        );
        if (!result.success) throw new Error(result.error || "Upload failed");

        await insertCarDocument(
          carData.id,
          "rental_agreement",
          path,
          provenance,
          contentSha256,
        );
      }

      toast.success("Vehicle submitted for approval!", { id: toastId });
      setShowForm(false);
      setForm({
        brand_id: null,
        model_id: null,
        plate_number: "",
        mileage: "",
        price_per_day: "",
        security_deposit_amount: "",
        location: "",
        city: "",
        specific_location: "",
        fuel_category: "",
        fuel_subtype: "",
        gps_available: false,
        contact_number: profile?.phone || "",
        manufacturing_year: "",
        additional_info: "",
        registration_expiry: "",
        ctpl_expiry: "",
        comprehensive_insurance_expiry: "",
        insurer_rental_use_confirmed: false,
        rental_agreement: "",
      });
      setCarImages([]);
      setOrFile(null);
      setOrBackFile(null);
      setCrFile(null);
      setCrBackFile(null);
      setRentalAgreementFile(null);
      fetchVehicles();
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null
            ? JSON.stringify(err)
            : String(err);
      
      if (errMsg.includes("duplicate key value") && errMsg.includes("cars_plate_number_key")) {
        toast.error("Duplicate Plate Number", { id: toastId, description: "This plate number is already registered in our system." });
      } else {
        toast.error("Failed to submit", { id: toastId, description: errMsg });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateVehicle = async () => {
    if (!editVehicle || !editPrice) return;
    const editPriceError = validateListingPrice(editPrice);
    if (editPriceError) {
      toast.error("Invalid listing price", { description: editPriceError });
      return;
    }
    const nextPrice = Number(editPrice);

    const nextSecurityDeposit =
      editSecurityDeposit === "" ? 0 : Number(editSecurityDeposit);
    if (
      !Number.isFinite(nextSecurityDeposit) ||
      nextSecurityDeposit < 0 ||
      nextSecurityDeposit > MAX_SECURITY_DEPOSIT
    ) {
      toast.error("Invalid security deposit amount", {
        description: `Security deposit must be between PHP 0 and PHP ${MAX_SECURITY_DEPOSIT.toLocaleString()}.`,
      });
      return;
    }

    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    if (!editRegistrationExpiry || editRegistrationExpiry < today) {
      toast.error("Current vehicle registration is required", {
        description: "Enter a registration expiry date that is today or later.",
      });
      return;
    }
    if (!editCtplExpiry || editCtplExpiry < today) {
      toast.error("Current CTPL coverage is required", {
        description: "Enter a CTPL expiry date that is today or later.",
      });
      return;
    }
    if (!editRentalUseConfirmed) {
      toast.error("Rental-use confirmation is required", {
        description: "Confirm that the intended rental use was disclosed to the insurer before resubmitting.",
      });
      return;
    }

    setEditing(true);
    const toastId = toast.loading("Saving changes...");

    try {
      if (editRentalAgreement) {
        toast.loading("Uploading new rental agreement...", { id: toastId });
        const path = `${user?.id}/${editVehicle.id}/rental_agreement_${Date.now()}`;
        const provenance = await inspectContentProvenance(editRentalAgreement);
        const contentSha256 = await hashFileSha256(editRentalAgreement);
        const result = await uploadFile(editRentalAgreement, "vehicle-private-documents", path);
        if (!result.success) throw new Error(result.error || "Upload failed");

        await supabase.from("car_documents").delete().eq("car_id", editVehicle.id).eq("document_type", "rental_agreement");
        await insertCarDocument(
          editVehicle.id,
          "rental_agreement",
          path,
          provenance,
          contentSha256,
        );
      }

      if (editCarImages.length > 0) {
        toast.loading("Uploading new car images...", { id: toastId });
        await supabase.from("car_images").delete().eq("car_id", editVehicle.id);
        for (let i = 0; i < editCarImages.length; i++) {
          const file = editCarImages[i];
          const path = `${user?.id}/${editVehicle.id}/image_${Date.now()}_${i}`;
          const result = await uploadFile(file, "vehicle-documents", path);
          if (result.success && result.url) {
            await supabase.from("car_images").insert({
              car_id: editVehicle.id,
              storage_path: result.url,
              is_primary: i === 0,
            });
          }
        }
      }

      toast.loading("Updating details...", { id: toastId });
      const { error } = await supabase
        .from("cars")
        .update({ 
          price_per_day: nextPrice,
          security_deposit_amount: nextSecurityDeposit,
          location:
            [editLocation, editCity, editSpecificLocation]
              .filter(Boolean)
              .join(" - ") || null,
          fuel_category: editFuelCategory || null,
          fuel_subtype: editFuelSubtype || null,
          gps_available: editGpsAvailable,
          contact_number: editContact || null,
          additional_info: editAdditionalInfo || null,
          registration_expiry: editRegistrationExpiry || null,
          ctpl_expiry: editCtplExpiry || null,
          comprehensive_insurance_expiry: editComprehensiveExpiry || null,
          insurer_rental_use_confirmed: editRentalUseConfirmed,
          insurance_verification_status: "pending",
          status: "pending",
          rejection_reason: null,
          last_verified_at: null,
        })
        .eq("id", editVehicle.id);

      if (error) throw error;
      
      toast.success("Vehicle changes submitted for admin review.", { id: toastId });
      setEditVehicle(null);
      fetchVehicles();
    } catch (error) {
      toast.error("Failed to update vehicle", {
        id: toastId,
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setEditing(false);
    }
  };

  const handleToggleVehicleLiveStatus = async (vehicle: VehicleRow) => {
    if (!user) return;

    const enabling = vehicle.status === "inactive";
    const nextStatus = enabling ? "approved" : "inactive";
    setVehicleActionId(vehicle.id);

    const toastId = toast.loading(
      enabling ? "Enabling vehicle listing..." : "Disabling vehicle listing...",
    );

    try {
      const { error } = await supabase
        .from("cars")
        .update({ status: nextStatus })
        .eq("id", vehicle.id)
        .eq("owner_id", user.id);

      if (error) throw error;

      toast.success(
        enabling
          ? "Vehicle listing is live again."
          : "Vehicle listing has been disabled.",
        { id: toastId },
      );
      fetchVehicles();
    } catch (error) {
      toast.error(enabling ? "Failed to enable vehicle" : "Failed to disable vehicle", {
        id: toastId,
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setVehicleActionId(null);
    }
  };

  const handleDeleteVehicle = async (vehicle: VehicleRow) => {
    if (!user) return;

    setVehicleActionId(vehicle.id);
    const toastId = toast.loading("Deleting vehicle...");

    try {
      const { error } = await supabase
        .from("cars")
        .delete()
        .eq("id", vehicle.id)
        .eq("owner_id", user.id);

      if (error) throw error;

      toast.success("Vehicle deleted.", { id: toastId });
      fetchVehicles();
    } catch (error) {
      toast.error("Failed to delete vehicle", {
        id: toastId,
        description:
          error instanceof Error
            ? error.message
            : "Check if the vehicle has bookings or try again.",
      });
    } finally {
      setVehicleActionId(null);
      setDeleteTargetVehicle(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <datalist id="vehicle-region-options">
        {VEHICLE_REGION_OPTIONS.map((region) => (
          <option key={region} value={region} />
        ))}
      </datalist>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Vehicles</h1>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <p className="text-muted-foreground">
              {vehicles.length}/{maxSlots} slots used
            </p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border capitalize ${
              activeSub?.plan_type === "premium"
                ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                : activeSub?.plan_type === "pro"
                ? "bg-blue-500/10 text-blue-500 border-blue-500/30"
                : "bg-muted text-muted-foreground border-border"
            }`}>
              {activeSub?.plan_type ?? "Free"} Plan
            </span>
            {!activeSub && (
              <Link to="/subscriptions" className="text-xs text-primary underline underline-offset-2">
                Upgrade for more slots
              </Link>
            )}
          </div>
        </div>
        {isVerifiedLister && canAddMore && !showForm && (
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Vehicle
          </Button>
        )}
        {!isVerifiedLister && !showForm && (
          <Link to="/verify">
            <Button variant="outline" className="gap-2 border-primary/40 text-primary">
              Complete Verification
            </Button>
          </Link>
        )}
        {isVerifiedLister && !canAddMore && !showForm && (
          <Link to="/subscriptions">
            <Button variant="outline" className="gap-2 border-primary/40 text-primary">
              Upgrade Plan
            </Button>
          </Link>
        )}
      </div>

      {(!isVerifiedLister || listingBlockedReason) && (
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Listing readiness</h2>
              <p className="text-sm text-muted-foreground">
                This card explains what still needs attention before another vehicle can be submitted.
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              listingBlockedReason
                ? "bg-amber-500/10 text-amber-600"
                : "bg-emerald-500/10 text-emerald-600"
            }`}>
              {listingBlockedReason ? "Action needed" : "Ready to list"}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className={`rounded-lg border px-3 py-3 text-sm ${isVerifiedLister ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
              <p className="font-medium">Identity verification</p>
              <p className="mt-1 text-muted-foreground">
                {isVerifiedLister
                  ? "Verified. You can submit vehicles for admin approval."
                  : "Still locked. Complete your /verify flow first so admin can approve your lister profile."}
              </p>
            </div>

            <div className={`rounded-lg border px-3 py-3 text-sm ${canAddMore ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
              <p className="font-medium">Available listing slots</p>
              <p className="mt-1 text-muted-foreground">
                {canAddMore
                  ? `${slotsRemaining} slot${slotsRemaining === 1 ? "" : "s"} remaining on your current plan.`
                  : `All ${maxSlots} slots are currently used. Upgrade your plan before adding another vehicle.`}
              </p>
            </div>
          </div>

          {!isVerifiedLister && (
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-sm">
            <p className="font-medium">How to unlock Lister Mode</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Most verification reviews finish within 24 hours. Complex cases
              may take 1 to 3 business days before lister access is unlocked.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Complete identity verification with your driver's license, backup ID, and selfies.</li>
              <li>Wait for admin approval so your profile becomes verified.</li>
              <li>Open the account menu and switch from Renter Mode to Lister Mode.</li>
              <li>Add or review your payout details, then submit your first vehicle for admin approval.</li>
            </ol>
          </div>
          )}

          {listingBlockedReason && (
            <p className="text-sm text-muted-foreground">
              {listingBlockedReason}
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {/* Add Vehicle Form */}
      {showForm && (
        <Card className="animate-scale-in border-primary/20">
          <CardHeader>
            <CardTitle>List a New Vehicle</CardTitle>
            <CardDescription>
              Your vehicle will be reviewed by our team before going live.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Brand *</Label>
                  <Select
                    value={form.brand_id || ""}
                    onValueChange={(val) => {
                      setForm({ ...form, brand_id: val, model_id: "" });
                      if (val) {
                        fetchModels(val);
                      }
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select brand">
                        {form.brand_id
                          ? brands.find((b) => b.id === form.brand_id)?.name
                          : "Select brand"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Model *</Label>
                  <Select
                    value={form.model_id || ""}
                    onValueChange={(val) => setForm({ ...form, model_id: val })}
                  >
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder="Select model">
                        {selectedModel
                          ? `${selectedModel.name} (${selectedModel.body_type})`
                          : "Select model"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[min(32rem,calc(100vw-2rem))] min-w-[var(--radix-select-trigger-width)]">
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {formatModelLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedModel ? (
                    <p className="text-xs text-muted-foreground break-words">
                      Selected: {formatModelLabel(selectedModel)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Pick the exact model, body type, seat count, and fuel type.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Fuel Category (Optional)</Label>
                  <Select
                    value={form.fuel_category || ""}
                    onValueChange={(val) =>
                      setForm({
                        ...form,
                        fuel_category: val ?? "",
                        fuel_subtype: "",
                      })
                    }
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select a category for extra fuel detail" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(FUEL_CATEGORY_OPTIONS).map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Optional only. This helps describe hybrid, diesel, electric, or alternative fuel setups more clearly.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Fuel Detail (Optional)</Label>
                  <Select
                    value={form.fuel_subtype || ""}
                    onValueChange={(val) =>
                      setForm({ ...form, fuel_subtype: val ?? "" })
                    }
                    disabled={!form.fuel_category}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue
                        placeholder={
                          form.fuel_category
                            ? "Select the matching fuel detail"
                            : "Choose a fuel category first"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFuelSubtypes.map((subtype) => (
                        <SelectItem key={subtype} value={subtype}>
                          {subtype}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Plate Number *</Label>
                  <Input
                    maxLength={8}
                    value={form.plate_number}
                    onChange={(e) => {
                      const val = e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9 -]/g, "");
                      setForm({ ...form, plate_number: val });
                      setPlateCheck({ status: "idle", message: "" });
                    }}
                    onBlur={() => checkPlateNumber(form.plate_number)}
                    placeholder="e.g. ABC 1234 or ABC-1234"
                    title={PLATE_NUMBER_HINT}
                    pattern={PLATE_NUMBER_PATTERN}
                    required
                  />
                  {(() => {
                    const formatError = form.plate_number
                      ? validatePlateNumber(form.plate_number)
                      : null;
                    if (formatError) {
                      return (
                        <p className="text-xs font-medium text-red-500">
                          {formatError}
                        </p>
                      );
                    }
                    if (plateCheck.message) {
                      return (
                        <p
                          className={`text-xs font-medium ${
                            plateCheck.status === "taken"
                              ? "text-red-500"
                              : plateCheck.status === "available"
                                ? "text-green-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {plateCheck.message}
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="space-y-2">
                  <Label>Mileage (km)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.mileage}
                    onChange={(e) =>
                      setForm({ ...form, mileage: e.target.value })
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Price per Day (PHP) *</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      PHP
                    </span>
                  <Input
                    type="number"
                    min="500"
                    max={MAX_LISTING_PRICE}
                    step="1"
                    placeholder="Min: 500, Max: 100000"
                    value={form.price_per_day}
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm({
                        ...form,
                        price_per_day:
                          value === ""
                            ? ""
                            : String(Math.min(Number(value), MAX_LISTING_PRICE)),
                      });
                    }}
                    required
                    className="pl-12 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  </div>
                  {form.price_per_day !== "" &&
                    validateListingPrice(form.price_per_day) && (
                      <p className="text-xs font-medium text-red-500">
                        {validateListingPrice(form.price_per_day)}
                      </p>
                    )}
                </div>
                <div className="space-y-2">
                  <Label>Security Deposit (PHP)</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      PHP
                    </span>
                  <Input
                    type="number"
                    min="0"
                    max={MAX_SECURITY_DEPOSIT}
                    step="1"
                    placeholder="Optional refundable deposit"
                    value={form.security_deposit_amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm({
                        ...form,
                        security_deposit_amount:
                          value === ""
                            ? ""
                            : String(Math.min(Number(value), MAX_SECURITY_DEPOSIT)),
                      });
                    }}
                    className="pl-12 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This is shown separately from the online booking total so renters know if an owner-set deposit may still apply.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Registration expiry *</Label>
                  <Input type="date" min={new Date().toISOString().slice(0, 10)} value={form.registration_expiry} onChange={(event) => setForm({ ...form, registration_expiry: event.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>CTPL expiry *</Label>
                  <Input type="date" min={new Date().toISOString().slice(0, 10)} value={form.ctpl_expiry} onChange={(event) => setForm({ ...form, ctpl_expiry: event.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Comprehensive insurance expiry</Label>
                  <Input type="date" value={form.comprehensive_insurance_expiry} onChange={(event) => setForm({ ...form, comprehensive_insurance_expiry: event.target.value })} />
                  <p className="text-xs text-muted-foreground">Optional for the thesis build, but a missing or expired policy creates an admin warning.</p>
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={form.insurer_rental_use_confirmed} onChange={(event) => setForm({ ...form, insurer_rental_use_confirmed: event.target.checked })} required />
                  <span><strong>Rental-use disclosure confirmed.</strong><span className="mt-1 block text-xs text-muted-foreground">I disclosed intended vehicle rental use to the insurer and understand SafeDrive does not guarantee that any policy covers peer-to-peer rental.</span></span>
                </label>
                <div className="space-y-4 sm:col-span-2">
                  <div className="space-y-2">
                    <Label>Pickup/Dropoff Region *</Label>
                    <Input
                      list="vehicle-region-options"
                      value={form.location}
                      onChange={(e) =>
                        setForm({ ...form, location: sanitizeVehicleRegionInput(e.target.value) })
                      }
                      placeholder="Type or select a region"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      You can type to search or select a region from the suggested list.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>City/Municipality *</Label>
                    <Input
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      placeholder="e.g. Quezon City, Makati, Pasig"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Specific Pick-up Location/Landmark *</Label>
                    <Input
                      value={form.specific_location}
                      onChange={(e) => setForm({ ...form, specific_location: e.target.value })}
                      placeholder="e.g. SM Megamall Building A entrance"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Contact Number</Label>
                  <Input
                    value={form.contact_number}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        contact_number: sanitizePhilippineMobileNumber(e.target.value),
                      })
                    }
                    maxLength={11}
                    placeholder="e.g. 0917 123 4567"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Additional Information</Label>
                  <Input
                    value={form.additional_info}
                    onChange={(e) =>
                      setForm({ ...form, additional_info: e.target.value })
                    }
                    placeholder="Any extra details about your car..."
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Optional Features</Label>
                  <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={form.gps_available}
                      onChange={(e) =>
                        setForm({ ...form, gps_available: e.target.checked })
                      }
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span className="space-y-1">
                      <span className="block font-medium">GPS available in vehicle</span>
                      <span className="block text-xs text-muted-foreground">
                        Use this only if the vehicle itself includes owner-provided GPS equipment. SafeDrive will not live-track the trip.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {/* Image uploads */}
              <div className="space-y-2">
                <Label>Car Images (minimum 1, up to 5) *</Label>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  <label className="flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors relative">
                    <ImageIcon className="w-5 h-5 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground text-center px-1">
                      {carImages.length > 0
                        ? `${carImages.length}/5 selected`
                        : "Click here"}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || [])
                          .slice(0, 5)
                          .filter((file) =>
                            validateUploadFile(file, ALLOWED_IMAGE_TYPES, "car image"),
                          );
                        setCarImages(files);
                      }}
                    />
                  </label>
                  {carImages.map((file, i) => (
                    <div
                      key={i}
                      className="relative h-24 rounded-lg overflow-hidden border group"
                    >
                      <img
                        src={URL.createObjectURL(file)}
                        alt="preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setCarImages(carImages.filter((_, index) => index !== i))}
                        className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <span className="text-white text-xs font-bold">Remove</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Original Receipt (OR) Front *</Label>
                  <div className="flex gap-4 items-start">
                    <label className="flex flex-col items-center justify-center w-[150px] h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors shrink-0">
                      <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground text-center px-1">
                        {orFile ? "Change OR front" : "Upload OR front"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          if (!file) {
                            setOrFile(null);
                            return;
                          }
                          if (validateUploadFile(file, ALLOWED_IMAGE_TYPES, "OR document")) {
                            setOrFile(file);
                          } else {
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </label>
                    {orFile && (
                      <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg border">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="text-sm font-medium">{orFile.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Original Receipt (OR) Back *</Label>
                  <div className="flex gap-4 items-start">
                    <label className="flex flex-col items-center justify-center w-[150px] h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors shrink-0">
                      <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground text-center px-1">
                        {orBackFile ? "Change OR back" : "Upload OR back"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          if (!file) {
                            setOrBackFile(null);
                            return;
                          }
                          if (validateUploadFile(file, ALLOWED_IMAGE_TYPES, "OR back document")) {
                            setOrBackFile(file);
                          } else {
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </label>
                    {orBackFile && (
                      <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg border">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="text-sm font-medium">{orBackFile.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Certificate of Registration (CR) Front *</Label>
                  <div className="flex gap-4 items-start">
                    <label className="flex flex-col items-center justify-center w-[150px] h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors shrink-0">
                      <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground text-center px-1">
                        {crFile ? "Change CR front" : "Upload CR front"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          if (!file) {
                            setCrFile(null);
                            return;
                          }
                          if (validateUploadFile(file, ALLOWED_IMAGE_TYPES, "CR document")) {
                            setCrFile(file);
                          } else {
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </label>
                    {crFile && (
                      <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg border">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="text-sm font-medium">{crFile.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Certificate of Registration (CR) Back *</Label>
                  <div className="flex gap-4 items-start">
                    <label className="flex flex-col items-center justify-center w-[150px] h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors shrink-0">
                      <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground text-center px-1">
                        {crBackFile ? "Change CR back" : "Upload CR back"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          if (!file) {
                            setCrBackFile(null);
                            return;
                          }
                          if (validateUploadFile(file, ALLOWED_IMAGE_TYPES, "CR back document")) {
                            setCrBackFile(file);
                          } else {
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </label>
                    {crBackFile && (
                      <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg border">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="text-sm font-medium">{crBackFile.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Rental Agreement (PDF) *</Label>
                {rentalAgreementFile ? (
                  <div className="flex items-center justify-between p-4 rounded-lg border border-green-500/50 bg-green-500/10">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-6 h-6 text-green-500" />
                      <div>
                        <p className="text-sm font-medium line-clamp-1">{rentalAgreementFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(rentalAgreementFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRentalAgreementFile(null)}>Remove</Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
                    <Upload className="w-5 h-5 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">Upload rental agreement (PDF only)</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        if (!file) {
                          setRentalAgreementFile(null);
                          return;
                        }
                        if (validateUploadFile(file, ALLOWED_PDF_TYPES, "rental agreement")) {
                          setRentalAgreementFile(file);
                        } else {
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={submitting} className="gap-2">
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  Submit for Approval
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      {/* Vehicle list */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5 flex gap-4">
                <Skeleton className="h-12 w-12 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : vehicles.length === 0 && !showForm ? (
        <div className="text-center py-20">
          <Car className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold">No vehicles listed</h3>
          <p className="text-muted-foreground text-sm mt-1 mb-4">
            Add your first vehicle to start earning.
          </p>
          {isVerifiedLister ? (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Add Vehicle
            </Button>
          ) : (
            <Link to="/verify">
              <Button variant="outline" className="gap-2 border-primary/40 text-primary">
                Complete Verification
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="vehicle-status-filter">Status</Label>
              <select
                id="vehicle-status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="active">Active</option>
                <option value="rejected">Rejected</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="vehicle-sort-order">Sort</Label>
              <select
                id="vehicle-sort-order"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Plate number</option>
                <option value="price_high">Highest price</option>
                <option value="price_low">Lowest price</option>
                <option value="brand">Brand and model</option>
              </select>
            </div>
          </div>

          {filteredVehicles.map((v) => {
            const badge = statusBadge[v.status] || statusBadge.pending;
            return (
              <Card key={v.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                      <Car className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-semibold">
                        {v.car_models.car_brands.name} {v.car_models.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        <span className="font-medium text-foreground">{v.plate_number}</span> &bull; ₱{Number(v.price_per_day).toLocaleString()}/day
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Security deposit:{" "}
                        <span className="font-medium text-foreground">
                          {Number(v.security_deposit_amount) > 0
                            ? `PHP ${Number(v.security_deposit_amount).toLocaleString()}`
                            : "None"}
                        </span>
                      </p>
                      {(v.fuel_category || v.fuel_subtype) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Fuel detail: {[v.fuel_category, v.fuel_subtype].filter(Boolean).join(" - ")}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        GPS option:{" "}
                        <span className="font-medium text-foreground">
                          {v.gps_available ? "Available" : "Not included"}
                        </span>
                      </p>
                      <p className={`mt-1 text-xs ${v.insurance_verification_status === "verified" ? "text-green-600" : "text-amber-600"}`}>
                        Insurance review: {v.insurance_verification_status.replace(/_/g, " ")}
                        {v.registration_expiry ? ` · registration ${v.registration_expiry}` : " · registration missing"}
                        {v.ctpl_expiry ? ` · CTPL ${v.ctpl_expiry}` : " · CTPL missing"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        {v.location && <span className="flex items-center gap-1">📍 {v.location}</span>}
                        {v.contact_number && <span className="flex items-center gap-1">📞 {v.contact_number}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const parsedLocation = parseStoredLocation(v.location);
                        setEditVehicle(v);
                        setEditPrice(v.price_per_day.toString());
                        setEditSecurityDeposit(
                          Number(v.security_deposit_amount) > 0
                            ? String(Number(v.security_deposit_amount))
                            : "",
                        );
                        setEditLocation(parsedLocation.region);
                        setEditCity(parsedLocation.city);
                        setEditSpecificLocation(parsedLocation.specificLocation);
                        setEditFuelCategory(v.fuel_category || "");
                        setEditFuelSubtype(v.fuel_subtype || "");
                        setEditGpsAvailable(Boolean(v.gps_available));
                        setEditContact(v.contact_number || "");
                        setEditAdditionalInfo(v.additional_info || "");
                        setEditRegistrationExpiry(v.registration_expiry || "");
                        setEditCtplExpiry(v.ctpl_expiry || "");
                        setEditComprehensiveExpiry(v.comprehensive_insurance_expiry || "");
                        setEditRentalUseConfirmed(Boolean(v.insurer_rental_use_confirmed));
                        setEditRentalAgreement(null);
                        setEditCarImages([]);
                      }}
                      disabled={vehicleActionId === v.id}
                    >
                      Edit
                    </Button>
                    {(isLiveVehicle(v.status) || v.status === "inactive") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleVehicleLiveStatus(v)}
                        disabled={vehicleActionId === v.id}
                        className={
                          v.status === "inactive"
                            ? "gap-2 text-green-600 hover:text-green-600"
                            : "gap-2 text-amber-600 hover:text-amber-600"
                        }
                      >
                        {vehicleActionId === v.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : v.status === "inactive" ? (
                          <Power className="w-3.5 h-3.5" />
                        ) : (
                          <PowerOff className="w-3.5 h-3.5" />
                        )}
                        {v.status === "inactive" ? "Enable" : "Disable"}
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeleteTargetVehicle(v)}
                      disabled={vehicleActionId === v.id}
                      className="gap-2"
                    >
                      {vehicleActionId === v.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editVehicle &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-6"
            onClick={() => setEditVehicle(null)}
          >
            <div className="flex min-h-full items-center justify-center">
              <Card
                className="my-4 flex w-full max-w-4xl flex-col overflow-hidden border-border/70 bg-card shadow-2xl sm:my-8"
                onClick={(e) => e.stopPropagation()}
              >
                <CardHeader className="shrink-0 border-b border-border/60 pb-4">
                  <CardTitle>Edit Listing: {editVehicle.plate_number}</CardTitle>
                  <CardDescription>
                    Update dynamic values like price. Sensitive values require
                    contacting support.
                  </CardDescription>
                </CardHeader>
                <CardContent className="max-h-[calc(100vh-11rem)] space-y-4 overflow-y-auto px-6 py-5">
                  <div className="space-y-2">
                    <Label>Price Per Day (PHP)</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                        PHP
                      </span>
                      <Input
                        type="number"
                        min="500"
                        max={MAX_LISTING_PRICE}
                        required
                        value={editPrice}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditPrice(
                            value === ""
                              ? ""
                              : String(Math.min(Number(value), MAX_LISTING_PRICE)),
                          );
                        }}
                        className="pl-12"
                      />
                    </div>
                    {editPrice !== "" && validateListingPrice(editPrice) && (
                      <p className="text-xs font-medium text-red-500">
                        {validateListingPrice(editPrice)}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Security Deposit (PHP)</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                        PHP
                      </span>
                      <Input
                        type="number"
                        min="0"
                        max={MAX_SECURITY_DEPOSIT}
                        value={editSecurityDeposit}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditSecurityDeposit(
                            value === ""
                              ? ""
                              : String(Math.min(Number(value), MAX_SECURITY_DEPOSIT)),
                          );
                        }}
                        placeholder="Optional refundable deposit"
                        className="pl-12"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This stays separate from the online booking total and helps renters understand the owner-set deposit expectation.
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="space-y-2"><Label>Registration expiry</Label><Input type="date" value={editRegistrationExpiry} onChange={(event) => setEditRegistrationExpiry(event.target.value)} /></label>
                    <label className="space-y-2"><Label>CTPL expiry</Label><Input type="date" value={editCtplExpiry} onChange={(event) => setEditCtplExpiry(event.target.value)} /></label>
                    <label className="space-y-2"><Label>Comprehensive expiry</Label><Input type="date" value={editComprehensiveExpiry} onChange={(event) => setEditComprehensiveExpiry(event.target.value)} /></label>
                  </div>
                  <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><input type="checkbox" className="mt-1" checked={editRentalUseConfirmed} onChange={(event) => setEditRentalUseConfirmed(event.target.checked)} /><span>I reconfirmed intended rental use with the insurer. Changing any insurance declaration sends this vehicle back to admin review.</span></label>
                  <div className="space-y-2">
                    <Label>Pickup Region</Label>
                    <Input
                      list="vehicle-region-options"
                      value={editLocation}
                      onChange={(e) => setEditLocation(sanitizeVehicleRegionInput(e.target.value))}
                      placeholder="Type or select a region"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>City/Municipality</Label>
                    <Input
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      placeholder="e.g. Quezon City, Makati, Pasig"
                    />
                    <p className="text-xs text-muted-foreground">
                      You can type the city or municipality manually here for testing or if no preset matches.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Specific Pick-up Location/Landmark</Label>
                    <Input
                      value={editSpecificLocation}
                      onChange={(e) => setEditSpecificLocation(e.target.value)}
                      placeholder="e.g. STI Novaliches, building entrance, mall pickup bay"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fuel Category</Label>
                    <Select
                      value={editFuelCategory}
                      onValueChange={(value) => {
                        setEditFuelCategory(value ?? "");
                        setEditFuelSubtype("");
                      }}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select a category for extra fuel detail" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(FUEL_CATEGORY_OPTIONS).map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Fuel Detail</Label>
                    <Select
                      value={editFuelSubtype}
                      onValueChange={(value) => setEditFuelSubtype(value ?? "")}
                      disabled={!editFuelCategory}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue
                          placeholder={
                            editFuelCategory
                              ? "Select the matching fuel detail"
                              : "Choose a fuel category first"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {availableEditFuelSubtypes.map((subtype) => (
                          <SelectItem key={subtype} value={subtype}>
                            {subtype}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Contact Number</Label>
                    <Input
                      value={editContact}
                      onChange={(e) => setEditContact(sanitizePhilippineMobileNumber(e.target.value))}
                      maxLength={11}
                      placeholder="Owner's contact number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Additional Information</Label>
                    <Input
                      value={editAdditionalInfo}
                      onChange={(e) => setEditAdditionalInfo(e.target.value)}
                      placeholder="Extra info, e.g. aircon not cold"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Optional Features</Label>
                    <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={editGpsAvailable}
                        onChange={(e) => setEditGpsAvailable(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-primary"
                      />
                      <span className="space-y-1">
                        <span className="block font-medium">GPS available in vehicle</span>
                        <span className="block text-xs text-muted-foreground">
                          This only marks the car as having GPS hardware or an owner-provided tracker. SafeDrive will not monitor the trip live.
                        </span>
                      </span>
                    </label>
                  </div>
                  <div className="space-y-2">
                    <Label>Update Rental Agreement (PDF)</Label>
                    <div className="flex items-center gap-4">
                      <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded border border-dashed p-2 transition hover:bg-muted/50">
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Upload className="h-3 w-3" />
                          {editRentalAgreement ? editRentalAgreement.name : "Choose New PDF (leave blank to keep current)"}
                        </span>
                        <input
                          type="file"
                          accept="application/pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            if (!file) {
                              setEditRentalAgreement(null);
                              return;
                            }
                            if (validateUploadFile(file, ALLOWED_PDF_TYPES, "rental agreement")) {
                              setEditRentalAgreement(file);
                            } else {
                              e.currentTarget.value = "";
                            }
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="space-y-2 pb-2">
                    <Label>Update Car Images</Label>
                    <div className="flex flex-col gap-2">
                      <label className="relative flex h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border transition-colors hover:border-primary/50">
                        <ImageIcon className="mb-1 h-5 w-5 text-muted-foreground" />
                        <span className="px-1 text-center text-xs text-muted-foreground">
                          {editCarImages.length > 0
                            ? `${editCarImages.length} new selected`
                            : "Click to Select New Images"}
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || [])
                              .slice(0, 5)
                              .filter((file) =>
                                validateUploadFile(file, ALLOWED_IMAGE_TYPES, "vehicle image"),
                              );
                            setEditCarImages(files);
                          }}
                        />
                      </label>
                      {editCarImages.length > 0 && (
                         <div className="mt-2 grid grid-cols-4 gap-2">
                           {editCarImages.map((file, i) => (
                             <div key={i} className="group relative h-16 overflow-hidden rounded-md border">
                               <img src={URL.createObjectURL(file)} className="h-full w-full object-cover" />
                               <button
                                 type="button"
                                 onClick={() => setEditCarImages(editCarImages.filter((_, index) => index !== i))}
                                 className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                               >
                                 <span className="text-[10px] font-bold text-white">X</span>
                               </button>
                             </div>
                           ))}
                         </div>
                      )}
                      <p className="mt-1 text-center text-[10px] font-medium leading-tight text-amber-500">
                        Warning: Uploading new images will delete all previous photos of the vehicle.
                      </p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="shrink-0 gap-3 border-t border-border/60 bg-card px-6 py-4">
                  <Button variant="outline" className="flex-1" onClick={() => setEditVehicle(null)} disabled={editing}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleUpdateVehicle}
                    disabled={editing}
                  >
                    {editing ? (
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>,
          document.body,
        )}
      <ConfirmDialog
        open={Boolean(deleteTargetVehicle)}
        title="Delete vehicle listing?"
        description={
          deleteTargetVehicle
            ? `Delete ${deleteTargetVehicle.car_models.car_brands.name} ${deleteTargetVehicle.car_models.name} (${deleteTargetVehicle.plate_number})? This cannot be undone.`
            : ""
        }
        confirmText="Delete Vehicle"
        destructive
        isLoading={Boolean(
          deleteTargetVehicle && vehicleActionId === deleteTargetVehicle.id,
        )}
        onCancel={() => setDeleteTargetVehicle(null)}
        onConfirm={() =>
          deleteTargetVehicle
            ? handleDeleteVehicle(deleteTargetVehicle)
            : Promise.resolve()
        }
      />
    </div>
  );
}

