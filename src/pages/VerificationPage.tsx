import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { inspectContentProvenance } from "@/lib/contentProvenance";
import {
  LICENSE_TRANSMISSION_LABEL,
  licenseExpiryLabel,
  licenseExpiryState,
  type LicenseTransmission,
} from "@/lib/driversLicense";
import { useVerificationEtaMessages } from "@/lib/platformSettings";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ShieldCheck,
  Upload,
  Loader2,
  Camera,
  CheckCircle,
  ImageIcon,
  FileWarning,
  DatabaseZap,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

const imageFields = [
  { key: "license_front", label: "Driver's License (Front)" },
  { key: "license_back", label: "Driver's License (Back)" },
  { key: "license_qr", label: "LTO Digital License (QR Code)" },
  { key: "national_id_front", label: "Secondary ID / Backup ID (Front)" },
  { key: "selfie_with_id", label: "Selfie Holding ID" },
  { key: "selfie", label: "Selfie (Face Only)" },
] as const;

type ImageFieldKey = (typeof imageFields)[number]["key"];

const liveSelfieFields = new Set<ImageFieldKey>(["selfie_with_id", "selfie"]);

const getErrorMessage = (error: unknown, fallback = "Something went wrong") =>
  error instanceof Error ? error.message : fallback;

const isMissingProvenanceColumnError = (message: string) =>
  message.toLowerCase().includes("provenance") ||
  message.toLowerCase().includes("review_flag") ||
  message.toLowerCase().includes("ai_suspicion");

type PsgcOption = {
  code: string;
  name: string;
  type?: string;
};

type PsgcBarangay = PsgcOption & {
  city_municipality?: {
    code?: string;
    name?: string;
  };
};

type StructuredAddress = {
  regionCode: string;
  regionName: string;
  cityCode: string;
  cityName: string;
  barangayCode: string;
  barangayName: string;
  manualBarangayName?: string;
  exactAddress: string;
};

const normalizePsgcOptions = (payload: unknown): PsgcOption[] => {
  if (Array.isArray(payload)) return payload as PsgcOption[];
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: PsgcOption[] }).data;
  }
  return [];
};

const fetchPsgcOptions = async (urls: string[]) => {
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) {
      continue;
    }

    const data = normalizePsgcOptions(await response.json());
    if (data.length > 0) {
      return data;
    }
  }

  return [] as PsgcOption[];
};

const fetchBarangaysForLocation = async (
  regionCode: string,
  cityCode: string,
  cityName: string,
) => {
  const directBarangays = await fetchPsgcOptions([
    `https://psgc.cloud/api/v2/cities-municipalities/${encodeURIComponent(cityCode)}/barangays`,
    `https://psgc.cloud/api/v2/cities/${encodeURIComponent(cityCode)}/barangays`,
    `https://psgc.cloud/api/v2/municipalities/${encodeURIComponent(cityCode)}/barangays`,
  ]);

  if (directBarangays.length > 0) {
    return directBarangays;
  }

  const regionResponse = await fetch(
    `https://psgc.cloud/api/v2/regions/${encodeURIComponent(regionCode)}/barangays`,
  );
  if (!regionResponse.ok) {
    return [] as PsgcOption[];
  }

  const regionBarangays = normalizePsgcOptions(
    await regionResponse.json(),
  ) as PsgcBarangay[];
  const normalizedCityCode = cityCode.trim();
  const normalizedCityName = normalizeLocationName(cityName);

  return regionBarangays.filter((barangay) => {
    const parentCode = barangay.city_municipality?.code?.trim() || "";
    const parentName = normalizeLocationName(
      barangay.city_municipality?.name || "",
    );

    return (
      parentCode === normalizedCityCode ||
      (normalizedCityName.length > 0 && parentName === normalizedCityName)
    );
  });
};

const createEmptyStructuredAddress = (): StructuredAddress => ({
  regionCode: "",
  regionName: "",
  cityCode: "",
  cityName: "",
  barangayCode: "",
  barangayName: "",
  manualBarangayName: "",
  exactAddress: "",
});

const repairMojibake = (value: string) =>
  value
    .replace(/ParaÃ±aque/g, "Parañaque")
    .replace(/paraÃ±aque/gi, "Parañaque")
    .replace(/Ã±/g, "ñ")
    .replace(/Ã‘/g, "Ñ");

const getLocationLabel = (option: PsgcOption | null | undefined) =>
  option
    ? `${repairMojibake(option.name)}${option.type ? ` (${option.type})` : ""}`
    : "";

const normalizeLocationName = (value: string) =>
  repairMojibake(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\([^)]*\)/g, "")
    .trim();

const findLocationMatch = (options: PsgcOption[], value: string) => {
  const normalizedValue = normalizeLocationName(value);
  if (!normalizedValue) return null;

  return (
    options.find(
      (option) => normalizeLocationName(getLocationLabel(option)) === normalizedValue,
    ) ||
    options.find(
      (option) => normalizeLocationName(option.name) === normalizedValue,
    ) ||
    null
  );
};

type SearchableLocationInputProps = {
  id: string;
  value: string;
  options: PsgcOption[];
  placeholder: string;
  onValueChange: (rawValue: string, match: PsgcOption | null) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  emptyMessage?: string;
  getOptionLabel?: (option: PsgcOption) => string;
};

const SearchableLocationInput = ({
  id,
  value,
  options,
  placeholder,
  onValueChange,
  disabled = false,
  required = false,
  className = "",
  emptyMessage = "No matching options found.",
  getOptionLabel = getLocationLabel,
}: SearchableLocationInputProps) => {
  const [open, setOpen] = useState(false);
  const [showAllOnOpen, setShowAllOnOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const blurTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const filteredOptions = useMemo(() => {
    if (showAllOnOpen) {
      return options.slice(0, 60);
    }

    const normalizedDraft = normalizeLocationName(draft);
    if (!normalizedDraft) {
      return options.slice(0, 60);
    }

    return options
      .filter((option) => {
        const label = normalizeLocationName(getOptionLabel(option));
        const name = normalizeLocationName(option.name);
        return label.includes(normalizedDraft) || name.includes(normalizedDraft);
      })
      .slice(0, 60);
  }, [draft, getOptionLabel, options, showAllOnOpen]);

  const openMenu = () => {
    if (disabled) return;
    if (blurTimeoutRef.current) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setShowAllOnOpen(true);
    setOpen(true);
  };

  const closeMenu = () => {
    blurTimeoutRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        onFocus={openMenu}
        onClick={openMenu}
        onBlur={closeMenu}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft(nextValue);
          setShowAllOnOpen(false);
          setOpen(true);
          onValueChange(nextValue, findLocationMatch(options, nextValue));
        }}
      />
      {open && !disabled ? (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-background shadow-lg">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const label = getOptionLabel(option);
              const selected = normalizeLocationName(label) === normalizeLocationName(value);
              return (
                <button
                  key={option.code}
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setDraft(label);
                    setShowAllOnOpen(false);
                    setOpen(false);
                    onValueChange(label, option);
                  }}
                >
                  {label}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {emptyMessage}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

const parseStructuredAddress = (rawAddress?: string | null): StructuredAddress => {
  if (!rawAddress) {
    return createEmptyStructuredAddress();
  }

  const parts = rawAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 4) {
    return {
      ...createEmptyStructuredAddress(),
      exactAddress: rawAddress.trim(),
    };
  }

  return {
    ...createEmptyStructuredAddress(),
    exactAddress: parts.slice(0, -3).join(", "),
    barangayName: parts.at(-3) || "",
    cityName: parts.at(-2) || "",
    regionName: parts.at(-1) || "",
  };
};

const getAge = (birthday: string) => {
  if (!birthday) return null;
  const birthDate = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

const normalizeDriverLicenseInput = (value: string) => {
  let raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length === 0) return "";

  const firstChar = raw.charAt(0);
  if (!/[A-Z]/.test(firstChar)) {
    return "";
  }

  let rest = raw.slice(1).replace(/\D/g, "");
  if (rest.length > 10) rest = rest.slice(0, 10);
  raw = firstChar + rest;

  let formatted = raw;
  if (raw.length > 3) {
    formatted = raw.slice(0, 3) + "-" + raw.slice(3);
  }
  if (raw.length > 5) {
    formatted = formatted.slice(0, 6) + "-" + raw.slice(5);
  }

  return formatted;
};

const isValidDriverLicense = (value: string) => /^[A-Z]\d{2}-\d{2}-\d{6}$/.test(value);

export default function VerificationPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { userMessage: verificationEtaMessage } = useVerificationEtaMessages();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivateError, setDeactivateError] = useState("");
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [formData, setFormData] = useState({
    first_name: profile?.first_name || "",
    middle_name: profile?.middle_name || "",
    last_name: profile?.last_name || "",
    phone: profile?.phone || "",
    address: profile?.address || "",
    birthday: profile?.birthday || "",
    driver_license: profile?.driver_license?.startsWith("pgp:")
      ? ""
      : profile?.driver_license || "",
    secondary_phone: profile?.secondary_phone || "",
  });
  const [addressDetails, setAddressDetails] = useState({
    regionCode: "",
    regionName: "",
    cityCode: "",
    cityName: "",
    barangayCode: "",
    barangayName: "",
    manualBarangayName: "",
    exactAddress: "",
  });
  const [regions, setRegions] = useState<PsgcOption[]>([]);
  const [cities, setCities] = useState<PsgcOption[]>([]);
  const [barangays, setBarangays] = useState<PsgcOption[]>([]);
  const [addressLoading, setAddressLoading] = useState({
    regions: false,
    cities: false,
    barangays: false,
  });
  const [addressError, setAddressError] = useState("");

  const [images, setImages] = useState<Record<ImageFieldKey, File | null>>({
    license_front: null,
    license_back: null,
    license_qr: null,
    national_id_front: null,
    selfie_with_id: null,
    selfie: null,
  });
  const [imagePreviews, setImagePreviews] = useState<
    Record<ImageFieldKey, string | null>
  >({
    license_front: null,
    license_back: null,
    license_qr: null,
    national_id_front: null,
    selfie_with_id: null,
    selfie: null,
  });
  const imagePreviewsRef = useRef<Record<ImageFieldKey, string | null>>({
    license_front: null,
    license_back: null,
    license_qr: null,
    national_id_front: null,
    selfie_with_id: null,
    selfie: null,
  });
  const [cameraField, setCameraField] = useState<ImageFieldKey | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [secondaryIdType, setSecondaryIdType] = useState("National ID");

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editPhone, setEditPhone] = useState(profile?.phone || "");
  const [editEmail, setEditEmail] = useState(profile?.email || "");
  const [editAddressDetails, setEditAddressDetails] = useState<StructuredAddress>(
    createEmptyStructuredAddress(),
  );
  const [editCities, setEditCities] = useState<PsgcOption[]>([]);
  const [editBarangays, setEditBarangays] = useState<PsgcOption[]>([]);
  const [editAddressLoading, setEditAddressLoading] = useState({
    cities: false,
    barangays: false,
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [addressTouched, setAddressTouched] = useState(false);
  const [licenseUpdateOpen, setLicenseUpdateOpen] = useState(false);
  const [licenseUpdateFiles, setLicenseUpdateFiles] = useState<
    Record<"license_qr" | "license_front" | "license_back", File | null>
  >({ license_qr: null, license_front: null, license_back: null });
  const [licenseUpdateSubmitting, setLicenseUpdateSubmitting] = useState(false);
  const regionOptions = useMemo(
    () => (Array.isArray(regions) ? regions : []),
    [regions],
  );
  const cityOptions = useMemo(
    () => (Array.isArray(cities) ? cities : []),
    [cities],
  );
  const barangayOptions = useMemo(
    () => (Array.isArray(barangays) ? barangays : []),
    [barangays],
  );
  const editCityOptions = useMemo(
    () => (Array.isArray(editCities) ? editCities : []),
    [editCities],
  );
  const editBarangayOptions = useMemo(
    () => (Array.isArray(editBarangays) ? editBarangays : []),
    [editBarangays],
  );
  const allowManualBarangay =
    !!addressDetails.cityCode &&
    !addressLoading.barangays &&
    barangayOptions.length === 0;
  const allowManualEditBarangay =
    !!editAddressDetails.cityCode &&
    !editAddressLoading.barangays &&
    editBarangayOptions.length === 0;

  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [isEditingPayout, setIsEditingPayout] = useState(false);
  const normalizeSupportedPayoutMethod = (value?: string | null) =>
    value === "Maya" ? "Maya" : "GCash";
  const getSupportedPayoutMethodLabel = (value?: string | null) =>
    value === "GCash" || value === "Maya" ? value : "Update required";

  const [payoutMethod, setPayoutMethod] = useState(
    normalizeSupportedPayoutMethod(profile?.payout_method),
  );
  const [payoutAccountName, setPayoutAccountName] = useState(profile?.payout_account_name || "");
  const [payoutAccountNumber, setPayoutAccountNumber] = useState(profile?.payout_account_number || "");
  const [isSavingPayout, setIsSavingPayout] = useState(false);
  const hasStructuredAddress =
    typeof profile?.address === "string" && profile.address.includes(",");
  const isPrivilegedAccount =
    profile?.role === "admin" || profile?.role === "super_admin";
  const isVerifiedAccount = profile?.verified_status === "verified";
  const showAccountSettings = isVerifiedAccount || isPrivilegedAccount;
  const canManagePayoutDetails =
    isVerifiedAccount && (profile?.is_lister || isPrivilegedAccount);
  const canDeleteAccountFromSettings = isVerifiedAccount || isPrivilegedAccount;

  const stopCameraStream = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const closeCameraCapture = () => {
    stopCameraStream();
    setCameraField(null);
    setCameraError("");
  };

  const startCameraCapture = async (fieldKey: ImageFieldKey) => {
    setCameraField(fieldKey);
    setCameraError("");
    setIsStartingCamera(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera capture is not supported by this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      cameraStreamRef.current = stream;
      setCameraStream(stream);
    } catch (error) {
      setCameraError(
        error instanceof Error
          ? error.message
          : "Unable to start the camera.",
      );
    } finally {
      setIsStartingCamera(false);
    }
  };

  const captureLiveSelfie = async () => {
    if (!cameraField || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      toast.error("Camera is still loading. Please try again.");
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, width, height);
    context.setTransform(1, 0, 0, 1, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );

    if (!blob) {
      toast.error("Failed to capture selfie. Please try again.");
      return;
    }

    const file = new File(
      [blob],
      `${cameraField}_live_${Date.now()}.jpg`,
      { type: "image/jpeg" },
    );

    handleImageChange(cameraField, file);
    toast.success("Live selfie captured");
    closeCameraCapture();
  };

  useEffect(() => {
    if (!cameraStream || !videoRef.current) return;

    videoRef.current.srcObject = cameraStream;
    void videoRef.current.play();
  }, [cameraField, cameraStream]);

  useEffect(
    () => () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      Object.values(imagePreviewsRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    },
    [],
  );

  useEffect(() => {
    imagePreviewsRef.current = imagePreviews;
  }, [imagePreviews]);

  useEffect(() => {
    let isMounted = true;

    const loadRegions = async () => {
      setAddressLoading((prev) => ({ ...prev, regions: true }));
      setAddressError("");
      try {
        const response = await fetch("https://psgc.cloud/api/v2/regions");
        if (!response.ok) throw new Error("Unable to load regions");
        const data = normalizePsgcOptions(await response.json());
        if (isMounted) setRegions(data);
      } catch (error) {
        if (isMounted) {
          setAddressError(getErrorMessage(error, "Please try again later."));
        }
        toast.error("Address list unavailable", {
          description: getErrorMessage(error, "Please try again later."),
        });
      } finally {
        if (isMounted) {
          setAddressLoading((prev) => ({ ...prev, regions: false }));
        }
      }
    };

    void loadRegions();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!addressDetails.regionCode) {
      setCities([]);
      return;
    }

    let isMounted = true;
    const loadCities = async () => {
      setAddressLoading((prev) => ({ ...prev, cities: true }));
      setAddressError("");
      try {
        const data = await fetchPsgcOptions([
          `https://psgc.cloud/api/v2/regions/${encodeURIComponent(addressDetails.regionCode)}/cities-municipalities`,
          `https://psgc.cloud/api/v2/regions/${encodeURIComponent(addressDetails.regionCode)}/cities`,
          `https://psgc.cloud/api/v2/regions/${encodeURIComponent(addressDetails.regionCode)}/municipalities`,
        ]);
        if (data.length === 0) {
          throw new Error("Unable to load cities");
        }
        if (isMounted) setCities(data);
      } catch (error) {
        if (isMounted) {
          setAddressError(getErrorMessage(error, "Please try again later."));
        }
        toast.error("City list unavailable", {
          description: getErrorMessage(error, "Please try again later."),
        });
      } finally {
        if (isMounted) {
          setAddressLoading((prev) => ({ ...prev, cities: false }));
        }
      }
    };

    void loadCities();

    return () => {
      isMounted = false;
    };
  }, [addressDetails.regionCode]);

  useEffect(() => {
    if (!addressDetails.cityCode || !addressDetails.regionCode) {
      setBarangays([]);
      return;
    }

    let isMounted = true;
    const loadBarangays = async () => {
      setAddressLoading((prev) => ({ ...prev, barangays: true }));
      setAddressError("");
      try {
        const data = await fetchBarangaysForLocation(
          addressDetails.regionCode,
          addressDetails.cityCode,
          addressDetails.cityName,
        );
        if (data.length === 0) {
          throw new Error("Unable to load barangays");
        }
        if (isMounted) setBarangays(data);
      } catch (error) {
        if (isMounted) {
          setAddressError(getErrorMessage(error, "Please try again later."));
        }
        toast.error("Barangay list unavailable", {
          description: getErrorMessage(error, "Please try again later."),
        });
      } finally {
        if (isMounted) {
          setAddressLoading((prev) => ({ ...prev, barangays: false }));
        }
      }
    };

    void loadBarangays();

    return () => {
      isMounted = false;
    };
  }, [
    addressDetails.cityCode,
    addressDetails.cityName,
    addressDetails.regionCode,
  ]);

  useEffect(() => {
    if (
      !isEditingProfile ||
      editAddressDetails.regionCode ||
      !editAddressDetails.regionName ||
      regionOptions.length === 0
    ) {
      return;
    }

    const matchingRegion = regionOptions.find(
      (region) =>
        normalizeLocationName(region.name) ===
        normalizeLocationName(editAddressDetails.regionName),
    );

    if (matchingRegion) {
      setEditAddressDetails((prev) => ({
        ...prev,
        regionCode: matchingRegion.code,
        regionName: matchingRegion.name,
      }));
    }
  }, [
    editAddressDetails.regionCode,
    editAddressDetails.regionName,
    isEditingProfile,
    regionOptions,
  ]);

  useEffect(() => {
    if (!editAddressDetails.regionCode) {
      setEditCities([]);
      return;
    }

    let isMounted = true;
    const loadEditCities = async () => {
      setEditAddressLoading((prev) => ({ ...prev, cities: true }));
      try {
        const data = await fetchPsgcOptions([
          `https://psgc.cloud/api/v2/regions/${encodeURIComponent(editAddressDetails.regionCode)}/cities-municipalities`,
          `https://psgc.cloud/api/v2/regions/${encodeURIComponent(editAddressDetails.regionCode)}/cities`,
          `https://psgc.cloud/api/v2/regions/${encodeURIComponent(editAddressDetails.regionCode)}/municipalities`,
        ]);
        if (isMounted) {
          setEditCities(data);
        }
      } finally {
        if (isMounted) {
          setEditAddressLoading((prev) => ({ ...prev, cities: false }));
        }
      }
    };

    void loadEditCities();

    return () => {
      isMounted = false;
    };
  }, [editAddressDetails.regionCode]);

  useEffect(() => {
    if (
      !isEditingProfile ||
      editAddressDetails.cityCode ||
      !editAddressDetails.cityName ||
      editCityOptions.length === 0
    ) {
      return;
    }

    const matchingCity = editCityOptions.find((city) => {
      const cityLabel = city.type ? `${city.name} (${city.type})` : city.name;
      return (
        normalizeLocationName(city.name) ===
          normalizeLocationName(editAddressDetails.cityName) ||
        normalizeLocationName(cityLabel) ===
          normalizeLocationName(editAddressDetails.cityName)
      );
    });

    if (matchingCity) {
      setEditAddressDetails((prev) => ({
        ...prev,
        cityCode: matchingCity.code,
        cityName: matchingCity.type
          ? `${matchingCity.name} (${matchingCity.type})`
          : matchingCity.name,
      }));
    }
  }, [
    editAddressDetails.cityCode,
    editAddressDetails.cityName,
    editCityOptions,
    isEditingProfile,
  ]);

  useEffect(() => {
    if (!editAddressDetails.cityCode || !editAddressDetails.regionCode) {
      setEditBarangays([]);
      return;
    }

    let isMounted = true;
    const loadEditBarangays = async () => {
      setEditAddressLoading((prev) => ({ ...prev, barangays: true }));
      try {
        const data = await fetchBarangaysForLocation(
          editAddressDetails.regionCode,
          editAddressDetails.cityCode,
          editAddressDetails.cityName,
        );
        if (isMounted) {
          setEditBarangays(data);
        }
      } finally {
        if (isMounted) {
          setEditAddressLoading((prev) => ({ ...prev, barangays: false }));
        }
      }
    };

    void loadEditBarangays();

    return () => {
      isMounted = false;
    };
  }, [
    editAddressDetails.cityCode,
    editAddressDetails.cityName,
    editAddressDetails.regionCode,
  ]);

  useEffect(() => {
    if (
      !isEditingProfile ||
      editAddressDetails.barangayCode ||
      !editAddressDetails.barangayName ||
      editBarangayOptions.length === 0
    ) {
      return;
    }

    const matchingBarangay = editBarangayOptions.find(
      (barangay) =>
        normalizeLocationName(barangay.name) ===
        normalizeLocationName(editAddressDetails.barangayName),
    );

    if (matchingBarangay) {
      setEditAddressDetails((prev) => ({
        ...prev,
        barangayCode: matchingBarangay.code,
        barangayName: matchingBarangay.name,
      }));
    }
  }, [
    editAddressDetails.barangayCode,
    editAddressDetails.barangayName,
    editBarangayOptions,
    isEditingProfile,
  ]);

  const beginEditingProfile = () => {
    const parsedAddress = parseStructuredAddress(profile?.address);
    const matchingRegion = regionOptions.find(
      (region) =>
        normalizeLocationName(region.name) ===
        normalizeLocationName(parsedAddress.regionName),
    );

    setEditPhone(profile?.phone || "");
    setEditEmail(profile?.email || "");
    setEditCities([]);
    setEditBarangays([]);
    setEditAddressDetails({
      ...parsedAddress,
      regionCode: matchingRegion?.code || "",
      regionName: matchingRegion?.name || parsedAddress.regionName,
    });
    setAddressTouched(false);
    setIsEditingProfile(true);
  };

  const handleUpdatePayoutDetails = async () => {
    if (!user) return;
    setIsSavingPayout(true);
    try {
      const { error } = await supabase.from("profiles").update({
        payout_method: payoutMethod,
        payout_account_name: payoutAccountName,
        payout_account_number: payoutAccountNumber,
      }).eq("id", user.id);
      
      if (error) throw error;
      toast.success("Payout details updated successfully!");
      await refreshProfile();
      setShowPayoutModal(false);
    } catch (err) {
      toast.error("Failed to update payout details", { description: getErrorMessage(err) });
    } finally {
      setIsSavingPayout(false);
    }
  };

  const handleLicenseUpdate = async () => {
    if (!user || licenseUpdateSubmitting) return;
    const entries = Object.entries(licenseUpdateFiles) as [
      "license_qr" | "license_front" | "license_back",
      File | null,
    ][];
    if (entries.some(([, file]) => !file)) {
      toast.error("Upload all three photos", {
        description: "LTO digital-licence QR, licence front, and licence back.",
      });
      return;
    }
    setLicenseUpdateSubmitting(true);
    const toastId = toast.loading("Uploading updated licence...");
    try {
      for (const [key, file] of entries) {
        if (!file) continue;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error("Only JPG, PNG, or WEBP images are allowed.");
        }
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${user.id}/${key}.${ext}`;
        const provenance = await inspectContentProvenance(file);
        const { error: uploadError } = await supabase.storage
          .from("user-verification")
          .upload(path, file, { upsert: true });
        if (uploadError) throw new Error(uploadError.message);
        await supabase
          .from("verification_images")
          .delete()
          .eq("user_id", user.id)
          .eq("image_type", key);
        const { error: insertError } = await supabase
          .from("verification_images")
          .insert({
            user_id: user.id,
            image_type: key,
            storage_path: path,
            ...provenance,
            review_flag: "needs_admin_review",
            review_reason: "Renter submitted an updated driver's licence.",
          });
        if (insertError) {
          const { error: fallbackError } = await supabase
            .from("verification_images")
            .insert({ user_id: user.id, image_type: key, storage_path: path });
          if (fallbackError) throw new Error(fallbackError.message);
        }
      }

      await supabase
        .from("profiles")
        .update({ license_update_pending: true })
        .eq("id", user.id);

      const { data: admins } = await supabase
        .from("profiles")
        .select("id")
        .in("role", ["admin", "super_admin"])
        .is("deleted_at", null);
      if (admins?.length) {
        await supabase.from("notifications").insert(
          admins.map((admin) => ({
            user_id: admin.id,
            title: "Driver's licence update submitted",
            message: `${profile?.full_name || profile?.email || "A renter"} submitted an updated driver's licence for review.`,
            type: "warning",
            link: "/admin/users",
          })),
        );
      }

      await refreshProfile();
      toast.success("Updated licence submitted", {
        id: toastId,
        description: "An admin will review it and refresh your expiry / transmission.",
      });
      setLicenseUpdateOpen(false);
      setLicenseUpdateFiles({
        license_qr: null,
        license_front: null,
        license_back: null,
      });
    } catch (err) {
      toast.error("Could not submit the updated licence", {
        id: toastId,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setLicenseUpdateSubmitting(false);
    }
  };

  const handleUpdateProfileDetails = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    const cleanPhone = editPhone.replace(/\s/g, "");
    if (!/^(09|\+639)\d{9}$/.test(cleanPhone)) {
      toast.error("Invalid phone format", { description: "Use 09XXXXXXXXX or +639XXXXXXXXX" });
      setIsSavingProfile(false);
      return;
    }
    
    // Check if email changed
    let emailChanged = false;
    if (editEmail && editEmail !== profile?.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail)) {
        toast.error("Invalid email address");
        setIsSavingProfile(false);
        return;
      }
      const { error: emailError } = await supabase.auth.updateUser({ email: editEmail });
      if (emailError) {
        toast.error("Failed to trigger email update", { description: emailError.message });
        setIsSavingProfile(false);
        return;
      }
      emailChanged = true;
    }

    const updatePayload: { phone: string; address?: string } = {
      phone: cleanPhone,
    };

    // Only re-validate and rebuild the structured address when the user
    // actually edited an address field. A phone-only edit must not be blocked
    // just because the saved address string cannot be perfectly re-matched
    // against the external PSGC list.
    if (addressTouched) {
      const exactAddress = editAddressDetails.exactAddress.trim();
      const resolvedBarangayName = (
        editAddressDetails.barangayName ||
        editAddressDetails.manualBarangayName ||
        ""
      ).trim();
      if (
        !editAddressDetails.regionCode ||
        !editAddressDetails.cityCode ||
        (!allowManualEditBarangay && !editAddressDetails.barangayCode) ||
        !resolvedBarangayName ||
        !exactAddress
      ) {
        toast.error("Complete the full address", {
          description:
            "Please select your region and city, then choose or type your barangay, and enter your house/street address before saving.",
        });
        setIsSavingProfile(false);
        return;
      }

      updatePayload.address = [
        exactAddress,
        resolvedBarangayName,
        editAddressDetails.cityName,
        editAddressDetails.regionName,
      ]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(", ");
    }

    const { error } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", user.id);
    if (error) {
      toast.error("Failed to update profile", { description: error.message });
    } else {
      await refreshProfile();
      if (emailChanged) {
        toast.success("Profile updated!", {
          description: `Your phone and address were updated. Check both ${profile?.email} and ${editEmail} to confirm your new email.`,
        });
      } else {
        toast.success("Profile updated successfully!");
      }
      setIsEditingProfile(false);
    }
    setIsSavingProfile(false);
  };

  if (profile?.verified_status === "verified") {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in space-y-6 pb-12">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <ShieldCheck className="w-8 h-8 text-green-500" />
              Account & Identity
            </h1>
            <p className="text-muted-foreground mt-1">
              Your account is fully verified and secure.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-green-500/10 text-green-500 px-4 py-2 rounded-full border border-green-500/20">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-bold uppercase tracking-wider">
              Verified
            </span>
          </div>
        </div>

        <Card className="overflow-hidden border-green-500/10">
          <div className="h-2 bg-green-500" />
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Verified Profile</CardTitle>
              <CardDescription>
                These details were verified against your government ID.
              </CardDescription>
            </div>
            {!isEditingProfile ? (
              <Button variant="outline" size="sm" onClick={beginEditingProfile}>
                Edit Details
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={isSavingProfile} onClick={handleUpdateProfileDetails}>
                  {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null} Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIsEditingProfile(false)}>Cancel</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-6">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Full Name
              </p>
              <p className="text-lg font-semibold">{profile.full_name}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email Address
              </p>
              {isEditingProfile ? (
                <div className="mt-1">
                  <Input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    type="email"
                    className="h-8 w-full"
                    placeholder="Enter new email"
                  />
                  {editEmail !== profile.email && (
                    <p className="text-[10px] text-amber-500 mt-1 layout-animation">
                      *Changing this will send OTPs to both your old and new emails.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-lg font-semibold">{profile.email}</p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contact Number
              </p>
              {isEditingProfile ? (
                <Input 
                  value={editPhone} 
                  maxLength={11}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setEditPhone(val);
                  }} 
                  className="h-8 mt-1" 
                />
              ) : (
                <p className="text-lg font-semibold">
                  {profile.phone || "Not provided"}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Birthday
              </p>
              <p className="text-lg font-semibold">
                {profile.birthday || "Not provided"}
              </p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Home Address
              </p>
              {isEditingProfile ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="edit_region" className="text-xs text-muted-foreground">
                      Region
                    </Label>
                    <SearchableLocationInput
                      id="edit_region"
                      value={editAddressDetails.regionName}
                      options={regionOptions}
                      className="h-9"
                      placeholder={
                        addressLoading.regions ? "Loading regions..." : "Type or select a region"
                      }
                      onValueChange={(rawValue, region) => {
                        setAddressTouched(true);
                        setEditAddressDetails((prev) => ({
                          ...prev,
                          regionCode: region?.code || "",
                          regionName: rawValue,
                          cityCode: "",
                          cityName: "",
                          barangayCode: "",
                          barangayName: "",
                          manualBarangayName: "",
                        }));
                        setEditCities([]);
                        setEditBarangays([]);
                      }}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Type to search or pick a region from the suggested list.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit_city" className="text-xs text-muted-foreground">
                      City / Municipality
                    </Label>
                    <SearchableLocationInput
                      id="edit_city"
                      value={editAddressDetails.cityName}
                      options={editCityOptions}
                      disabled={
                        !editAddressDetails.regionCode || editAddressLoading.cities
                      }
                      className="h-9 disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder={
                        !editAddressDetails.regionCode
                          ? "Select region first"
                          : editAddressLoading.cities
                            ? "Loading cities..."
                            : "Type or select a city or municipality"
                      }
                      onValueChange={(rawValue, city) => {
                        setAddressTouched(true);
                        setEditAddressDetails((prev) => ({
                          ...prev,
                          cityCode: city?.code || "",
                          cityName: rawValue,
                          barangayCode: "",
                          barangayName: "",
                          manualBarangayName: "",
                        }));
                        setEditBarangays([]);
                      }}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Search the city or municipality list by typing its name.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit_barangay" className="text-xs text-muted-foreground">
                      Barangay
                    </Label>
                    {allowManualEditBarangay ? (
                      <Input
                        value={editAddressDetails.manualBarangayName || ""}
                        onChange={(e) => {
                          setAddressTouched(true);
                          setEditAddressDetails((prev) => ({
                            ...prev,
                            barangayCode: "",
                            barangayName: "",
                            manualBarangayName: e.target.value,
                          }));
                        }}
                        className="h-9 mt-2"
                        placeholder="Type barangay manually if it is not listed"
                      />
                    ) : (
                      <SearchableLocationInput
                        id="edit_barangay"
                        value={editAddressDetails.barangayName}
                        options={editBarangayOptions}
                        disabled={
                          !editAddressDetails.cityCode || editAddressLoading.barangays
                        }
                        className="h-9 disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder={
                          !editAddressDetails.cityCode
                            ? "Select city first"
                            : editAddressLoading.barangays
                              ? "Loading barangays..."
                              : "Type or select a barangay"
                        }
                        emptyMessage="No matching barangays found. You can clear and type manually if the list fails to load."
                        onValueChange={(rawValue, barangay) => {
                          setAddressTouched(true);
                          setEditAddressDetails((prev) => ({
                            ...prev,
                            barangayCode: barangay?.code || "",
                            barangayName: rawValue,
                            manualBarangayName: "",
                          }));
                        }}
                      />
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {allowManualEditBarangay
                        ? "Barangay list is unavailable for this location right now. You can type it manually."
                        : "Type to search or select your barangay. If nothing loads, you can type it manually."}
                    </p>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label
                      htmlFor="edit_exact_address"
                      className="text-xs text-muted-foreground"
                    >
                      House / Street Address
                    </Label>
                    <Input
                      id="edit_exact_address"
                      value={editAddressDetails.exactAddress}
                      onChange={(e) => {
                        setAddressTouched(true);
                        setEditAddressDetails((prev) => ({
                          ...prev,
                          exactAddress: e.target.value,
                        }));
                      }}
                      className="h-9"
                      placeholder="House no., street, building, unit"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Edit and save the full address using house/street, barangay, city, and region.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-lg font-semibold break-words whitespace-normal">
                  {profile.address || "Not provided"}
                  </p>
                  {profile.address && !hasStructuredAddress && (
                    <p className="text-[10px] text-amber-500">
                      Legacy address record detected. Edit details to save the full house/barangay/city/region format.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {canManagePayoutDetails && (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Payout Details</CardTitle>
                <CardDescription>
                  Update where SafeDrive should send your rental payouts.
                </CardDescription>
              </div>
              {!isEditingPayout ? (
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setPayoutMethod(normalizeSupportedPayoutMethod(profile?.payout_method));
                    setPayoutAccountName(profile?.payout_account_name || "");
                    setPayoutAccountNumber(profile?.payout_account_number || "");
                    setIsEditingPayout(true);
                  }}
                >
                  Edit Payout Details
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" disabled={isSavingPayout || !payoutAccountName || !payoutAccountNumber} onClick={handleUpdatePayoutDetails}>
                    {isSavingPayout ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setPayoutMethod(normalizeSupportedPayoutMethod(profile?.payout_method));
                      setPayoutAccountName(profile?.payout_account_name || "");
                      setPayoutAccountNumber(profile?.payout_account_number || "");
                      setIsEditingPayout(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Payout Method
                </p>
                {isEditingPayout ? (
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="GCash">GCash</option>
                    <option value="Maya">Maya</option>
                  </select>
                ) : (
                  <p className="text-lg font-semibold">{getSupportedPayoutMethodLabel(profile.payout_method)}</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Account Name
                </p>
                {isEditingPayout ? (
                  <Input value={payoutAccountName} onChange={(e) => setPayoutAccountName(e.target.value)} placeholder="Account holder name" />
                ) : (
                  <p className="text-lg font-semibold break-words">{profile.payout_account_name || "Not set"}</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Account Number
                </p>
                {isEditingPayout ? (
                  <Input value={payoutAccountNumber} onChange={(e) => setPayoutAccountNumber(e.target.value.replace(/[^\d]/g, ""))} placeholder="Wallet or account number" />
                ) : (
                  <p className="text-lg font-semibold break-all">{profile.payout_account_number || "Not set"}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>
              Your identity documents are securely stored and verified.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50 border border-border/50">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">
                  Identity Documents Verified
                </p>
                <p className="text-xs text-muted-foreground">
                  Driver's License and National ID have been approved.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Driver&apos;s Licence</CardTitle>
              <CardDescription>
                Validity and transmission are set by an admin from your uploaded
                licence. Submit an updated licence when yours is renewed.
              </CardDescription>
            </div>
            {profile.license_update_pending ? (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600">
                Update under review
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Expiry
                </p>
                <p
                  className={`text-sm font-semibold ${
                    licenseExpiryState(profile.license_expiry) === "expired"
                      ? "text-red-500"
                      : licenseExpiryState(profile.license_expiry) === "expiring"
                        ? "text-amber-500"
                        : "text-foreground"
                  }`}
                >
                  {licenseExpiryLabel(profile.license_expiry)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Transmission
                </p>
                <p className="text-sm font-semibold">
                  {profile.license_transmission
                    ? LICENSE_TRANSMISSION_LABEL[
                        profile.license_transmission as LicenseTransmission
                      ]
                    : "Not reviewed yet"}
                </p>
              </div>
            </div>

            {licenseExpiryState(profile.license_expiry) === "expired" && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                Your licence has expired. New bookings are on hold until an admin
                reviews an updated licence.{" "}
                <span className="text-muted-foreground">
                  Listing and managing your own vehicles is not affected — a
                  driver&apos;s licence is only needed to rent.
                </span>
              </p>
            )}
            {profile.is_lister &&
              licenseExpiryState(profile.license_expiry) === "expiring" && (
                <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Your licence on file expires soon. It still stands as your
                  identity record for hosting, but submitting a renewed licence
                  keeps your verification current.
                </p>
              )}
            {profile.license_transmission === "automatic_only" && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
                Your licence is automatic-only, so you can book automatic
                vehicles only. Submit an updated licence if this has changed.
              </p>
            )}

            {!licenseUpdateOpen ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLicenseUpdateOpen(true)}
                >
                  Update licence
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(
                      "/support?tag=license_dispute&subject=Driver's licence details",
                    )
                  }
                >
                  Report a mistake in my licence details
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  Upload clear photos of your current licence. If a photo is too
                  blurry an admin can reject it with a reason.
                </p>
                {(
                  [
                    { key: "license_qr", label: "LTO digital-licence QR code" },
                    { key: "license_front", label: "Licence front" },
                    { key: "license_back", label: "Licence back (shows AT / AT-MT)" },
                  ] as const
                ).map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">{f.label}</Label>
                    <Input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={licenseUpdateSubmitting}
                      onChange={(e) =>
                        setLicenseUpdateFiles((prev) => ({
                          ...prev,
                          [f.key]: e.target.files?.[0] ?? null,
                        }))
                      }
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={licenseUpdateSubmitting}
                    onClick={() => void handleLicenseUpdate()}
                  >
                    {licenseUpdateSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Submit updated licence"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={licenseUpdateSubmitting}
                    onClick={() => setLicenseUpdateOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center border-t border-border/40 pt-4 mt-6">
          <Button
            variant="outline"
            onClick={() => navigate("/browse")}
            className="rounded-xl w-1/2"
          >
            Back to Browse
          </Button>
        </div>
        
        {showAccountSettings && (
        <div className="mt-12 space-y-4 max-w-4xl mx-auto">
          <h3 className="text-xl font-bold tracking-tight text-foreground border-b border-border pb-2">Security & Account Settings</h3>
          <Card className="bg-transparent border border-border">
            <CardContent className="p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
               <div>
                  <p className="font-semibold text-foreground">Change Password</p>
                  <p className="text-xs text-muted-foreground">Update your account password securely.</p>
               </div>
               <Button variant="outline" onClick={() => setShowChangePasswordModal(true)}>
                 Change Password
               </Button>
            </CardContent>
            <CardContent className="p-5 border-t border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
               <div>
                  <p className="flex items-center gap-2 font-semibold text-foreground"><DatabaseZap className="h-4 w-4" /> Privacy &amp; Data Requests</p>
                  <p className="text-xs text-muted-foreground">Request access, correction, restriction, anonymization, or deletion of eligible personal data.</p>
               </div>
               <Button variant="outline" type="button" onClick={() => navigate("/privacy-request")}>Manage Data Requests</Button>
            </CardContent>
            <CardContent className="p-5 border-t border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
               <div>
                  <p className="font-semibold text-red-500">Account Deletion Request</p>
                  <p className="text-xs text-muted-foreground">Request reviewed deletion or anonymization of eligible account data.</p>
               </div>
                <Button variant="destructive" type="button" onClick={() => { setDeactivateError(""); setShowDeactivateModal(true); }}>
                 Request Account Deletion
               </Button>
            </CardContent>
          </Card>
        </div>
        )}
        
        {showDeactivateModal &&
          createPortal(
          <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in">
            <div className="bg-background border border-red-500/20 rounded-lg shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
              <div className="p-6 text-center space-y-4">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-2 border border-red-500/20">
                  <FileWarning className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-xl font-bold tracking-tight text-foreground">Request Account Deletion?</h3>
                <p className="text-sm text-muted-foreground">
                  You will be taken to the privacy-request page. SafeDrive must verify the request and review legal, safety, payment, dispute, and record-retention obligations before deleting or anonymizing eligible data.
                </p>
              </div>
              {deactivateError && (
                <div className="px-6 py-2 bg-red-500/10 border-t border-b border-red-500/20 text-red-500 text-xs font-semibold">
                  Error: {deactivateError}
                </div>
              )}
              <div className="p-4 bg-muted/30 border-t border-border flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => setShowDeactivateModal(false)}
                >
                  Cancel
                </Button>
                <Button 
                  variant="destructive" 
                  type="button"
                  className="flex-1"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowDeactivateModal(false);
                    navigate("/privacy-request?type=deletion");
                  }}
                >
                  Continue to Privacy Request
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
        
        {showChangePasswordModal &&
          createPortal(
          <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in" onClick={() => setShowChangePasswordModal(false)}>
            <Card className="max-w-sm w-full shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()}>
               <CardHeader>
                 <CardTitle>Change Password</CardTitle>
                 <CardDescription>Enter your new password below.</CardDescription>
               </CardHeader>
               <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>New Password</Label>
                    <div className="relative">
                      <Input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Confirm Password</Label>
                    <div className="relative">
                      <Input
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button 
                     className="w-full"
                     disabled={isSubmitting || newPassword.length < 6 || newPassword !== confirmPassword}
                     onClick={async () => {
                        setIsSubmitting(true);
                        try {
                          const { error } = await supabase.auth.updateUser({ password: newPassword });
                          if (error) throw error;
                          toast.success("Password updated successfully!");
                          setShowChangePasswordModal(false);
                          setNewPassword("");
                          setConfirmPassword("");
                        } catch (err) {
                          toast.error(getErrorMessage(err, "Failed to update password"));
                        } finally {
                          setIsSubmitting(false);
                        }
                     }}
                  >
                     {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save New Password"}
               </Button>
             </CardContent>
          </Card>
        </div>,
        document.body,
      )}
      </div>
    );
  }

  if (profile?.verified_status === "pending") {
    return (
      <div className="max-w-lg mx-auto text-center py-20 animate-fade-in">
        <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-6">
          <ShieldCheck className="w-10 h-10 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Verification Pending</h2>
        <p className="text-muted-foreground mb-6">
          Your verification is being reviewed by our team. {verificationEtaMessage}{" "}
          We&apos;ll notify you as soon as the decision is ready.
        </p>
        <Button variant="outline" onClick={() => navigate("/browse")}>
          Go to Browse
        </Button>
      </div>
    );
  }

  const handleImageChange = (key: ImageFieldKey, file: File | null) => {
    if (file) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error("Only WEBP, JPG, and PNG files are allowed");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File size must be under 10MB");
        return;
      }
    }
    setImages((prev) => ({ ...prev, [key]: file }));
    setImagePreviews((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]!);
      return { ...prev, [key]: file ? URL.createObjectURL(file) : null };
    });
  };

  const handleRemoveImage = (key: ImageFieldKey) => {
    setImages((prev) => ({ ...prev, [key]: null }));
    setImagePreviews((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]!);
      return { ...prev, [key]: null };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Validate all images are uploaded
    const missingImages = imageFields.filter((f) => !images[f.key]);
    if (missingImages.length > 0) {
      toast.error("Please upload all required images", {
        description: `Missing: ${missingImages.map((f) => f.label).join(", ")}`,
      });
      return;
    }

    const cleanPhone = formData.phone.replace(/\s/g, "");
    const phoneRegex = /^(09|\+639)\d{9}$/;
    if (!phoneRegex.test(cleanPhone)) {
      toast.error("Invalid phone format", {
        description:
          "Please use a valid Philippine number (09XXXXXXXXX or +639XXXXXXXXX).",
      });
      return;
    }

    const age = getAge(formData.birthday);
    if (age !== null && age < 18) {
      toast.error("Age requirement not met", {
        description: "You must be at least 18 years old to be verified.",
      });
      return;
    }

    const exactAddress = addressDetails.exactAddress.trim();
    const resolvedBarangayName = (
      addressDetails.barangayName ||
      addressDetails.manualBarangayName ||
      ""
    ).trim();
    if (
      !addressDetails.regionCode ||
      !addressDetails.cityCode ||
      (!allowManualBarangay && !addressDetails.barangayCode) ||
      !resolvedBarangayName ||
      !exactAddress
    ) {
      toast.error("Complete address required", {
        description:
          "Select your region and city or municipality, then choose or type your barangay, and enter your house or street address.",
      });
      return;
    }

    const fullAddress = [
      exactAddress,
      resolvedBarangayName,
      addressDetails.cityName,
      addressDetails.regionName,
    ]
      .filter(Boolean)
      .join(", ");

    const normalizedDriverLicense = normalizeDriverLicenseInput(
      formData.driver_license || "",
    );
    if (!isValidDriverLicense(normalizedDriverLicense)) {
      toast.error("Driver's License required", {
        description:
          "Please enter a valid driver's license number using the format X00-00-000000.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Step 1: Use RPC to clear old verification data (bypasses RLS via SECURITY DEFINER)
      // Falls back to direct delete if RPC doesn't exist yet
      if (profile?.verified_status === "rejected") {
        const { error: rpcError } = await (
          supabase.rpc as unknown as (
            fn: string,
          ) => Promise<{ error: { message: string } | null }>
        )("clear_verification_for_retry");
        if (rpcError) {
          console.warn("RPC fallback:", rpcError.message);
          // Fallback: try direct delete
          const { error: deleteError } = await supabase
            .from("verification_images")
            .delete()
            .eq("user_id", user.id);
          if (deleteError) throw new Error("Verification Images Delete: " + deleteError.message);
        }
      }

      // Step 2: Upload images sequentially to storage
      const imagePaths: {
        image_type: string;
        storage_path: string;
        provenance_status: string;
        provenance_source: string | null;
        provenance_summary: string | null;
        ai_suspicion_score: number | null;
        ai_detector_name: string | null;
        ai_detector_version: string | null;
        review_flag: string;
        review_reason: string | null;
      }[] = [];
      for (const field of imageFields) {
        const file = images[field.key]!;
        const ext = file.name.split(".").pop();
        const path = `${user.id}/${field.key}.${ext}`;
        const provenance = await inspectContentProvenance(file);

        const { error: uploadError } = await supabase.storage
          .from("user-verification")
          .upload(path, file, { upsert: true });

        if (uploadError) throw new Error("Storage Upload (" + field.key + "): " + uploadError.message);
        imagePaths.push({
          image_type: field.key,
          storage_path: path,
          ...provenance,
        });
      }

      // Step 3: Insert verification image records
      const { error: insertError } = await supabase
        .from("verification_images")
        .insert(
          imagePaths.map((img) => ({
            user_id: user.id,
            image_type: img.image_type,
            storage_path: img.storage_path,
            provenance_status: img.provenance_status,
            provenance_source: img.provenance_source,
            provenance_summary: img.provenance_summary,
            ai_suspicion_score: img.ai_suspicion_score,
            ai_detector_name: img.ai_detector_name,
            ai_detector_version: img.ai_detector_version,
            review_flag: img.review_flag,
            review_reason: img.review_reason,
          }))
        );
      if (insertError) {
        if (isMissingProvenanceColumnError(insertError.message)) {
          console.warn(
            "Verification provenance columns are not live yet; saving uploads without provenance metadata.",
            insertError.message,
          );
          const { error: fallbackInsertError } = await supabase
            .from("verification_images")
            .insert(
              imagePaths.map((img) => ({
                user_id: user.id,
                image_type: img.image_type,
                storage_path: img.storage_path,
              })),
            );
          if (fallbackInsertError) {
            throw new Error("Verification Images Insert: " + fallbackInsertError.message);
          }
        } else {
          throw new Error("Verification Images Insert: " + insertError.message);
        }
      }

      // Step 4: Update profile with ONLY valid column names (no spreading formData which includes invalid keys)
      const fullName = [
        formData.first_name,
        formData.middle_name,
        formData.last_name,
      ]
        .filter(Boolean)
        .join(" ");

      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: formData.first_name,
          middle_name: formData.middle_name,
          last_name: formData.last_name,
          full_name: fullName,
          phone: cleanPhone,
          address: fullAddress,
          birthday: formData.birthday || null,
          driver_license: normalizedDriverLicense,
          national_id: null,
          secondary_id_type: secondaryIdType,
          secondary_phone: formData.secondary_phone || null,
          payout_method: payoutMethod,
          payout_account_name: payoutAccountName || null,
          payout_account_number: payoutAccountNumber || null,
          verified_status: "pending",
          // KYC selfies stay in private storage and are never reused as public avatars.
          avatar_url: profile?.avatar_url?.includes("/user-verification/")
            ? null
            : profile?.avatar_url ?? null,
        })
        .eq("id", user.id);

      if (error) throw new Error("Profile Update: " + error.message);

      await refreshProfile();
      toast.success("Verification submitted!", {
        description: verificationEtaMessage,
      });
    } catch (err: unknown) {
      const error = err as Error;
      toast.error("Submission failed", { description: error.message });
    }

    setIsSubmitting(false);
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <datalist id="verification-region-options">
        {regionOptions.map((region) => (
          <option key={region.code} value={region.name} />
        ))}
      </datalist>
      <datalist id="verification-city-options">
        {cityOptions.map((city) => (
          <option key={city.code} value={getLocationLabel(city)} />
        ))}
      </datalist>
      <datalist id="verification-barangay-options">
        {barangayOptions.map((barangay) => (
          <option key={barangay.code} value={barangay.name} />
        ))}
      </datalist>
      <datalist id="verification-edit-region-options">
        {regionOptions.map((region) => (
          <option key={region.code} value={region.name} />
        ))}
      </datalist>
      <datalist id="verification-edit-city-options">
        {editCityOptions.map((city) => (
          <option key={city.code} value={getLocationLabel(city)} />
        ))}
      </datalist>
      <datalist id="verification-edit-barangay-options">
        {editBarangayOptions.map((barangay) => (
          <option key={barangay.code} value={barangay.name} />
        ))}
      </datalist>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-primary" />
          Identity Verification
        </h1>
        <p className="text-muted-foreground mt-1">
          Complete verification to start booking or listing cars.
        </p>
      </div>

      {profile?.verified_status === "rejected" && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50">
          <p className="text-sm text-red-700 dark:text-red-400 font-medium">
            Your previous verification was rejected.
          </p>
          {profile.rejection_reason && (
            <p className="text-sm text-red-600 dark:text-red-400/80 mt-1">
              Reason: {profile.rejection_reason}
            </p>
          )}
        </div>
      )}

      <div className="mb-6 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50">
          <p className="text-sm text-blue-800 dark:text-blue-300 font-bold mb-1">
            Identity Delimitation Policy
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-400">
            To comply with safety regulations, SafeDrive STRICTLY accepts only: <br />
            <strong>1. Driver's License</strong> <br />
            <strong>2. One secondary or backup ID: National ID, UMID, Voter's ID, Postal ID, PhilHealth ID, School ID, Company ID, Barangay ID, SSS ID, or TIN ID</strong> <br />
            SafeDrive uses the secondary or backup ID for image-based manual review only. Only the front image is required for the selected ID. Passport remains excluded from accepted backup IDs at this time.
          </p>
        </div>

      <div className="mb-6 p-4 rounded-lg bg-muted/40 border border-border/60">
        <p className="text-sm font-semibold">How lister access is unlocked</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {verificationEtaMessage}
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Submit the full identity verification form on this page.</li>
          <li>Wait for admin approval and the verified status badge.</li>
          <li>Open your account menu and switch to Lister Mode.</li>
          <li>Set your payout details and submit your first vehicle for admin review.</li>
        </ol>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Provide your legal name and contact information.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^a-zA-Z\s-]/g, "");
                  setFormData({ ...formData, first_name: val });
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="middle_name">Middle Name</Label>
              <Input
                id="middle_name"
                maxLength={80}
                placeholder="Leave blank if none"
                value={formData.middle_name}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^a-zA-Z\s'-]/g, "");
                  setFormData({ ...formData, middle_name: val });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^a-zA-Z\s-]/g, "");
                  setFormData({ ...formData, last_name: val });
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Contact Number *</Label>
              <Input
                id="phone"
                maxLength={11}
                placeholder="09171234567"
                value={formData.phone}
                onChange={(e) => {
                  let val = e.target.value.replace(/\D/g, "");
                  if (val.length > 11) val = val.slice(0, 11);
                  setFormData({ ...formData, phone: val });
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary_phone">Secondary Number (Optional)</Label>
              <Input
                id="secondary_phone"
                maxLength={11}
                placeholder="09171234567"
                value={formData.secondary_phone || ""}
                onChange={(e) => {
                  let val = e.target.value.replace(/\D/g, "");
                  if (val.length > 11) val = val.slice(0, 11);
                  setFormData({ ...formData, secondary_phone: val });
                }}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="region">Region *</Label>
                {addressDetails.regionName && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={() => {
                      setAddressDetails((prev) => ({
                        ...prev,
                        regionCode: "",
                        regionName: "",
                        cityCode: "",
                        cityName: "",
                        barangayCode: "",
                        barangayName: "",
                        manualBarangayName: "",
                      }));
                      setCities([]);
                      setBarangays([]);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <SearchableLocationInput
                id="region"
                value={addressDetails.regionName}
                options={regionOptions}
                className="h-10"
                placeholder={
                  addressLoading.regions ? "Loading regions..." : "Type or select a region"
                }
                required
                onValueChange={(rawValue, region) => {
                  setAddressDetails((prev) => ({
                    ...prev,
                    regionCode: region?.code || "",
                    regionName: rawValue,
                    cityCode: "",
                    cityName: "",
                    barangayCode: "",
                    barangayName: "",
                    manualBarangayName: "",
                  }));
                  setCities([]);
                  setBarangays([]);
                }}
              />
              {addressError && regionOptions.length === 0 ? (
                <p className="text-xs font-medium text-red-500">
                  Address list could not load. Refresh the page or check your connection.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Start here. Type to search, then choose a valid region from the suggested list.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="city">City / Municipality *</Label>
                {addressDetails.cityName && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={() => {
                      setAddressDetails((prev) => ({
                        ...prev,
                        cityCode: "",
                        cityName: "",
                        barangayCode: "",
                        barangayName: "",
                        manualBarangayName: "",
                      }));
                      setBarangays([]);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <SearchableLocationInput
                id="city"
                value={addressDetails.cityName}
                options={cityOptions}
                disabled={!addressDetails.regionCode || addressLoading.cities}
                className="h-10 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={
                  !addressDetails.regionCode
                    ? "Select region first"
                    : addressLoading.cities
                      ? "Loading cities..."
                      : "Type or select a city or municipality"
                }
                required
                onValueChange={(rawValue, city) => {
                  setAddressDetails((prev) => ({
                    ...prev,
                    cityCode: city?.code || "",
                    cityName: rawValue,
                    barangayCode: "",
                    barangayName: "",
                    manualBarangayName: "",
                  }));
                  setBarangays([]);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {addressDetails.regionCode
                  ? "Search the city or municipality list by typing its name."
                  : "This becomes available after selecting a region."}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="barangay">Barangay *</Label>
                {(addressDetails.barangayName || addressDetails.manualBarangayName) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={() =>
                      setAddressDetails((prev) => ({
                        ...prev,
                        barangayCode: "",
                        barangayName: "",
                        manualBarangayName: "",
                      }))
                    }
                  >
                    Clear
                  </Button>
                )}
              </div>
              {allowManualBarangay ? (
                <Input
                  value={addressDetails.manualBarangayName || ""}
                  onChange={(event) =>
                    setAddressDetails((prev) => ({
                      ...prev,
                      barangayCode: "",
                      barangayName: "",
                      manualBarangayName: event.target.value,
                    }))
                  }
                  placeholder="Type barangay manually if it is not listed"
                  required
                />
              ) : (
                <SearchableLocationInput
                  id="barangay"
                  value={addressDetails.barangayName}
                  options={barangayOptions}
                  disabled={!addressDetails.cityCode || addressLoading.barangays}
                  className="h-10 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={
                    !addressDetails.cityCode
                      ? "Select city first"
                      : addressLoading.barangays
                        ? "Loading barangays..."
                        : "Type or select a barangay"
                  }
                  required
                  emptyMessage="No matching barangays found. You can clear and type manually if the list fails to load."
                  onValueChange={(rawValue, barangay) => {
                    setAddressDetails((prev) => ({
                      ...prev,
                      barangayCode: barangay?.code || "",
                      barangayName: rawValue,
                      manualBarangayName: "",
                    }));
                  }}
                />
              )}
              <p className="text-xs text-muted-foreground">
                {addressDetails.cityCode
                  ? allowManualBarangay
                    ? "Barangay list is unavailable for this location right now. You can type it manually."
                    : "Type to search or select your barangay. If nothing loads, you can type it manually."
                  : "This becomes available after selecting a city or municipality."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="exact_address">House / Street Address *</Label>
              <Input
                id="exact_address"
                placeholder="House no., street, building, unit"
                value={addressDetails.exactAddress}
                onChange={(event) =>
                  setAddressDetails((prev) => ({
                    ...prev,
                    exactAddress: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthday">Birthday *</Label>
              <Input
                id="birthday"
                type="date"
                value={formData.birthday}
                onChange={(e) =>
                  setFormData({ ...formData, birthday: e.target.value })
                }
                aria-invalid={getAge(formData.birthday) !== null && getAge(formData.birthday)! < 18}
                required
              />
              {getAge(formData.birthday) !== null &&
                getAge(formData.birthday)! < 18 && (
                  <p className="text-xs font-medium text-red-500">
                    You must be at least 18 years old to use SafeDrive.
                  </p>
                )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>License and Secondary ID / Backup ID</CardTitle>
            <CardDescription>
              Your driver's license number and one secondary or backup ID type.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="driver_license">Driver's License *</Label>
              <Input
                id="driver_license"
                placeholder="X00-00-000000"
                maxLength={13}
                value={formData.driver_license}
                className="font-mono tracking-wide"
                onChange={(e) => {
                  const formatted = normalizeDriverLicenseInput(e.target.value);
                  setFormData((prev) => ({ ...prev, driver_license: formatted }));
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary_id_type">Secondary ID / Backup ID Type *</Label>
              <select
                id="secondary_id_type"
                value={secondaryIdType}
                onChange={(e) => setSecondaryIdType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="National ID">National ID</option>
                <option value="UMID">UMID</option>
                <option value="Voter's ID">Voter's ID</option>
                <option value="Postal ID">Postal ID</option>
                <option value="PhilHealth ID">PhilHealth ID</option>
                <option value="School ID">School ID</option>
                <option value="Company ID">Company ID</option>
                <option value="Barangay ID">Barangay ID</option>
                <option value="SSS ID">SSS ID</option>
                <option value="TIN ID">TIN ID</option>
              </select>
              <p className="text-xs text-muted-foreground">
                No optional ID number is collected anymore. Upload the front image of the selected secondary or backup ID below for manual review. Passport is not accepted in this backup ID list.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lister Payout Preference</CardTitle>
            <CardDescription>
              If you plan to use lister mode, tell SafeDrive where you prefer rental payouts to go. This records your preferred destination for review and payout handling.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="payout_method">Preferred Payout Destination</Label>
              <select
                id="payout_method"
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="GCash">GCash</option>
                <option value="Maya">Maya</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payout_account_name">Account Name</Label>
              <Input
                id="payout_account_name"
                value={payoutAccountName}
                onChange={(e) => setPayoutAccountName(e.target.value)}
                placeholder="Account holder name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payout_account_number">Account Number</Label>
              <Input
                id="payout_account_number"
                value={payoutAccountNumber}
                onChange={(e) => setPayoutAccountNumber(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Wallet or account number"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Verification Images</CardTitle>
            <CardDescription>
              Upload clear document photos. Selfies must be taken live with your camera.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              {imageFields.map((field) => {
                const requiresLiveCapture = liveSelfieFields.has(field.key);

                return (
                  <div key={field.key} className="space-y-2">
                    <Label>{field.label} *</Label>
                    {requiresLiveCapture ? (
                      <div
                        className={`flex flex-col items-center justify-center h-32 rounded-lg border-2 border-dashed transition-colors ${
                          images[field.key]
                            ? "border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                            : "border-border bg-muted/30"
                        }`}
                      >
                        {images[field.key] ? (
                          <div className="relative h-full w-full overflow-hidden rounded-md">
                            {imagePreviews[field.key] && (
                              <img
                                src={imagePreviews[field.key]!}
                                alt={`${field.label} preview`}
                                className="h-full w-full object-cover"
                              />
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-black/65 p-2 text-center text-white">
                              <p className="text-xs font-medium">
                                Live selfie captured
                              </p>
                              <div className="mt-1 flex justify-center gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => startCameraCapture(field.key)}
                                >
                                  Retake
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => handleRemoveImage(field.key)}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center px-3">
                            <Camera className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                            <p className="text-xs text-muted-foreground mb-2">
                              Camera capture required
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-2"
                              onClick={() => startCameraCapture(field.key)}
                            >
                              <Camera className="w-3.5 h-3.5" />
                              Start Camera
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <label
                        className={`flex flex-col items-center justify-center h-32 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                          images[field.key]
                            ? "border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        }`}
                      >
                        {images[field.key] ? (
                          <div className="relative h-full w-full overflow-hidden rounded-md">
                            {imagePreviews[field.key] && (
                              <img
                                src={imagePreviews[field.key]!}
                                alt={`${field.label} preview`}
                                className="h-full w-full object-cover"
                              />
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-black/65 p-2 text-center text-white">
                              <CheckCircle className="mx-auto mb-1 h-4 w-4 text-green-300" />
                              <p className="truncate text-xs">
                                {images[field.key]!.name}
                              </p>
                              <div className="mt-1 flex justify-center gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 text-xs"
                                >
                                  Change Photo
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    handleRemoveImage(field.key);
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center">
                            <ImageIcon className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                            <p className="text-xs text-muted-foreground">
                              Click to upload
                            </p>
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) =>
                            handleImageChange(
                              field.key,
                              e.target.files?.[0] || null,
                            )
                          }
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Button
          type="submit"
          className="w-full h-11 text-base shadow-lg shadow-primary/20"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" /> Submit for Verification
            </>
          )}
        </Button>
      </form>

      {cameraField &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in"
            onClick={closeCameraCapture}
          >
            <Card
              className="w-full max-w-xl overflow-hidden animate-scale-in max-h-[calc(100vh-2rem)]"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Live Selfie Capture</CardTitle>
                  <CardDescription>
                    Use the live camera feed to capture your selfie directly from the device camera.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={closeCameraCapture}
                >
                  <X className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 overflow-y-auto">                <div className="relative aspect-video overflow-hidden rounded-lg bg-black border">
                  {isStartingCamera && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                      <Loader2 className="w-6 h-6 animate-spin mr-2" />
                      Starting camera...
                    </div>
                  )}
                  {cameraError ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-200">
                      {cameraError}
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      className="h-full w-full object-cover scale-x-[-1]"
                      playsInline
                      muted
                    />
                  )}
                </div>

                <canvas ref={canvasRef} className="hidden" />                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    type="button"
                    className="flex-1 gap-2"
                    onClick={captureLiveSelfie}
                    disabled={
                      isStartingCamera ||
                      Boolean(cameraError) ||
                      !cameraStream
                    }
                  >
                    <Camera className="w-4 h-4" />
                    Capture Selfie
                  </Button>                </div>
              </CardContent>
            </Card>
          </div>,
          document.body,
        )}

      {showAccountSettings && (
      <div className="mt-12 space-y-4 max-w-4xl mx-auto">
        <h3 className="text-xl font-bold tracking-tight text-white border-b border-border pb-2">Security & Account Settings</h3>
        <Card className="bg-transparent border border-border">
          {(profile?.verified_status === "verified" || profile?.role === "admin" || profile?.role === "super_admin") && (
            <CardContent className="p-5 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
               <div>
                  <p className="font-semibold text-foreground">Change Password</p>
                  <p className="text-xs text-muted-foreground">Update your account password securely.</p>
               </div>
               <Button variant="outline" onClick={() => setShowChangePasswordModal(true)}>
                 Change Password
               </Button>
            </CardContent>
          )}
          
          {canManagePayoutDetails && (
            <CardContent className="p-5 border-t border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
               <div>
                  <p className="font-semibold text-foreground">Payout Details (Lister)</p>
                  <p className="text-xs text-muted-foreground">Manage your GCash or Maya account for receiving rental payouts.</p>
               </div>
               <Button variant="outline" onClick={() => {
                 setPayoutMethod(normalizeSupportedPayoutMethod(profile?.payout_method));
                 setPayoutAccountName(profile?.payout_account_name || "");
                 setPayoutAccountNumber(profile?.payout_account_number || "");
                 setShowPayoutModal(true);
               }}>
                 Update Payout Info
               </Button>
            </CardContent>
          )}

          <CardContent className="p-5 border-t border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
             <div>
                <p className="flex items-center gap-2 font-semibold text-foreground"><DatabaseZap className="h-4 w-4" /> Privacy &amp; Data Requests</p>
                <p className="text-xs text-muted-foreground">Request access, correction, restriction, anonymization, or deletion of eligible personal data.</p>
             </div>
             <Button variant="outline" type="button" onClick={() => navigate("/privacy-request")}>Manage Data Requests</Button>
          </CardContent>

          {canDeleteAccountFromSettings && (
            <CardContent className="p-5 border-t border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
               <div>
                  <p className="font-semibold text-red-500">Account Deletion Request</p>
                  <p className="text-xs text-muted-foreground">Request reviewed deletion or anonymization of eligible account data.</p>
               </div>
                <Button variant="destructive" type="button" onClick={() => { setDeactivateError(""); setShowDeactivateModal(true); }}>
                 Request Account Deletion
               </Button>
            </CardContent>
          )}
        </Card>
      </div>
      )}

      {showChangePasswordModal &&
        createPortal(
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in" onClick={() => setShowChangePasswordModal(false)}>
          <Card className="max-w-sm w-full shadow-2xl animate-scale-in relative border-0" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => setShowChangePasswordModal(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
             <CardHeader className="pt-6">
               <CardTitle>Change Password</CardTitle>
               <CardDescription>Enter your new password below.</CardDescription>
             </CardHeader>
             <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <div className="relative">
                    <Input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Confirm Password</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button 
                   className="w-full"
                   disabled={isSubmitting || newPassword.length < 6 || newPassword !== confirmPassword}
                   onClick={async () => {
                      setIsSubmitting(true);
                      try {
                        const { error } = await supabase.auth.updateUser({ password: newPassword });
                        if (error) throw error;
                        toast.success("Password updated successfully!");
                        setShowChangePasswordModal(false);
                        setNewPassword("");
                        setConfirmPassword("");
                      } catch (err) {
                        toast.error(getErrorMessage(err, "Failed to update password"));
                      } finally {
                        setIsSubmitting(false);
                      }
                   }}
                >
                   {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save New Password"}
                </Button>
             </CardContent>
          </Card>
        </div>,
        document.body,
      )}
      
      {showDeactivateModal &&
        createPortal(
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in">
          <div className="bg-background border border-red-500/20 rounded-lg shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in">
            <div className="p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-2 border border-red-500/20">
                <FileWarning className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-foreground">Request Account Deletion?</h3>
              <p className="text-sm text-muted-foreground">
                You will be taken to the privacy-request page. SafeDrive must verify the request and review legal, safety, payment, dispute, and record-retention obligations before deleting or anonymizing eligible data.
              </p>
            </div>
            {deactivateError && (
              <div className="px-6 py-2 bg-red-500/10 border-t border-b border-red-500/20 text-red-500 text-xs font-semibold">
                Error: {deactivateError}
              </div>
            )}
            <div className="p-4 bg-muted/30 border-t border-border flex gap-3">
              <Button 
                variant="outline" 
                className="flex-1 bg-transparent border-white/10 hover:bg-white/5"
                onClick={() => setShowDeactivateModal(false)}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                type="button"
                className="flex-1"
                onClick={(e) => {
                  e.preventDefault();
                  setShowDeactivateModal(false);
                  navigate("/privacy-request?type=deletion");
                }}
              >
                Continue to Privacy Request
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showPayoutModal &&
        createPortal(
        <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm p-4 py-6 animate-fade-in" onClick={() => setShowPayoutModal(false)}>
          <Card className="max-w-sm w-full shadow-2xl animate-scale-in relative border-0" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => setShowPayoutModal(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
             <CardHeader className="pt-6">
               <CardTitle>Payout Details</CardTitle>
               <CardDescription>Enter your account info to receive payments securely.</CardDescription>
             </CardHeader>
             <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Payout Method</Label>
                  <select 
                    value={payoutMethod} 
                    onChange={(e) => setPayoutMethod(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="GCash">GCash</option>
                    <option value="Maya">Maya</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Account Name</Label>
                  <Input 
                    type="text" 
                    placeholder="e.g., Juan Dela Cruz"
                    value={payoutAccountName} 
                    onChange={(e) => setPayoutAccountName(e.target.value)} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Account Number</Label>
                  <Input 
                    type="text" 
                    placeholder="e.g., 09123456789"
                    value={payoutAccountNumber} 
                    onChange={(e) => setPayoutAccountNumber(e.target.value.replace(/[^\d]/g, ""))} 
                  />
                </div>
                <Button 
                   className="w-full"
                   disabled={isSavingPayout || !payoutAccountName || !payoutAccountNumber}
                   onClick={handleUpdatePayoutDetails}
                >
                   {isSavingPayout ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                   Save Payout Info
                </Button>
             </CardContent>
          </Card>
        </div>,
        document.body,
      )}
    </div>
  );
}




