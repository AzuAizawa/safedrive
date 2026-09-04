import { useState, useEffect, useCallback } from "react";

import { useAuth } from "@/contexts/AuthContext";
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
  FileWarning,
  Upload,
  Loader2,
  CheckCircle,
  Car as CarIcon,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { CarWithDetails, CarRenewal, Database } from "@/types/database";

const renewalDocs = [
  { key: "orcr_document_path", label: "Updated OR/CR" },
  { key: "lto_receipt_path", label: "Latest LTO Receipt" },
  { key: "mvir_path", label: "MVIR (Motor Vehicle Inspection Report)" },
  { key: "emission_test_path", label: "Latest Emission Test Result" },
  { key: "updated_car_photos_path", label: "Updated Car Photos (Zip/Image)" },
] as const;

export default function ListerCarRenewalPage() {
  const { user } = useAuth();

  const [carsForRenewal, setCarsForRenewal] = useState<CarWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCar, setSelectedCar] = useState<CarWithDetails | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeRenewals, setActiveRenewals] = useState<
    Record<string, CarRenewal>
  >({});

  const [mileage, setMileage] = useState<string>("");
  const [files, setFiles] = useState<Record<string, File | null>>({
    orcr_document_path: null,
    lto_receipt_path: null,
    mvir_path: null,
    emission_test_path: null,
    updated_car_photos_path: null,
    ctpl_document_path: null,
    comprehensive_document_path: null,
  });
  const [registrationExpiry, setRegistrationExpiry] = useState("");
  const [ctplExpiry, setCtplExpiry] = useState("");
  const [comprehensiveExpiry, setComprehensiveExpiry] = useState("");

  const fetchRenewalData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      // Any live listing can submit updated registration/CTPL/comprehensive
      // documents here, not only one already forced offline - a lister
      // should be able to renew ahead of the expiry date, not just after.
      const { data: carsData, error: carsError } = await supabase
        .from("cars")
        .select(
          `
          *,
          car_models (*, car_brands(*)),
          car_images (*)
        `,
        )
        .eq("owner_id", user.id)
        .in("status", ["approved", "active", "renewal_required"]);

      if (carsError) throw carsError;

      // Fetch pending renewals to check if they already submitted
      const { data: renewalsData, error: renewalsError } = await supabase
        .from("car_renewals")
        .select("*")
        .eq("lister_id", user.id)
        .in("status", ["pending", "rejected"]);

      if (renewalsError) throw renewalsError;

      const pendingMap: Record<string, CarRenewal> = {};
      renewalsData.forEach((renewal) => {
        pendingMap[renewal.car_id] = renewal;
      });

      setCarsForRenewal(carsData as unknown as CarWithDetails[]);
      setActiveRenewals(pendingMap);
    } catch (err: unknown) {
      toast.error("Failed to load renewal data", {
        description: (err as Error).message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchRenewalData();
  }, [fetchRenewalData]);

  const selectCarForRenewal = (car: CarWithDetails) => {
    setMileage("");
    setFiles({
      orcr_document_path: null,
      lto_receipt_path: null,
      mvir_path: null,
      emission_test_path: null,
      updated_car_photos_path: null,
      ctpl_document_path: null,
      comprehensive_document_path: null,
    });
    setRegistrationExpiry(car.registration_expiry ?? "");
    setCtplExpiry(car.ctpl_expiry ?? "");
    setComprehensiveExpiry(car.comprehensive_insurance_expiry ?? "");
    setSelectedCar(car);
  };

  const handleFileChange = (key: string, file: File | null) => {
    if (file && file.size > 10 * 1024 * 1024) {
      toast.error("File size must be under 10MB");
      return;
    }
    setFiles((prev) => ({ ...prev, [key]: file }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedCar) return;

    if (!mileage || isNaN(Number(mileage))) {
      toast.error("Invalid mileage", {
        description: "Please enter a valid number",
      });
      return;
    }

    const missingDocs = renewalDocs.filter((d) => !files[d.key]);
    if (missingDocs.length > 0) {
      toast.error("Please upload all required documents");
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (!registrationExpiry || registrationExpiry < todayIso) {
      toast.error("Registration expiry is required", {
        description: "Enter the new registration expiry date from your updated OR/CR.",
      });
      return;
    }
    if (!ctplExpiry || ctplExpiry < todayIso) {
      toast.error("CTPL expiry is required", {
        description: "Enter the new CTPL expiry date.",
      });
      return;
    }
    if (!files.ctpl_document_path) {
      toast.error("CTPL document is required", {
        description: "Upload the updated CTPL certificate/policy.",
      });
      return;
    }
    if (Boolean(comprehensiveExpiry) !== Boolean(files.comprehensive_document_path)) {
      toast.error("Comprehensive insurance is incomplete", {
        description:
          "Provide both the expiry date and the document, or leave both blank if you have no comprehensive policy.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const docsToUpload = [
        ...renewalDocs,
        { key: "ctpl_document_path" as const, label: "CTPL document" },
        ...(files.comprehensive_document_path
          ? [{ key: "comprehensive_document_path" as const, label: "Comprehensive document" }]
          : []),
      ];

      const uploadPromises = docsToUpload.map(async (doc) => {
        const file = files[doc.key]!;
        const ext = file.name.split(".").pop();
        const path = `renewals/${user.id}/${selectedCar.id}/${doc.key}_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("car-documents")
          .upload(path, file);

        if (uploadError) throw uploadError;
        return { key: doc.key, path };
      });

      const uploadResults = await Promise.all(uploadPromises);

      const insertData: Database["public"]["Tables"]["car_renewals"]["Insert"] = {
        car_id: selectedCar.id,
        lister_id: user.id,
        current_mileage: parseInt(mileage),
        status: "pending",
        orcr_document_path: "",
        lto_receipt_path: "",
        mvir_path: "",
        emission_test_path: "",
        updated_car_photos_path: "",
        registration_expiry: registrationExpiry,
        ctpl_expiry: ctplExpiry,
        comprehensive_insurance_expiry: comprehensiveExpiry || null,
        ctpl_document_path: null,
        comprehensive_document_path: null,
      };

      uploadResults.forEach((res) => {
        insertData[res.key] = res.path;
      });

      const { error: dbError } = await supabase
        .from("car_renewals")
        .insert(insertData);
      if (dbError) throw dbError;

      toast.success("Renewal submitted successfully!", {
        description: "Our team will review your documents.",
      });

      setSelectedCar(null);
      void fetchRenewalData();
    } catch (err: unknown) {
      toast.error("Submission failed", { description: (err as Error).message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12 w-full px-4 sm:px-0">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <FileWarning className="w-8 h-8 text-amber-500" />
          Registration &amp; Insurance Renewal
        </h1>
        <p className="text-muted-foreground mt-1">
          Submit updated registration, CTPL, and comprehensive-insurance
          documents and dates - required once a vehicle is flagged, or any
          time you want to renew ahead of the expiry.
        </p>
      </div>

      {!selectedCar ? (
        <Card>
          <CardHeader>
            <CardTitle>Your Vehicles</CardTitle>
            <CardDescription>
              Select a vehicle below to submit updated compliance documents and
              dates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {carsForRenewal.length === 0 ? (
              <div className="text-center py-12 border rounded-xl bg-muted/20">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold">No live listings yet</h3>
                <p className="text-muted-foreground">
                  Once you have an approved vehicle, it will show up here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {carsForRenewal.map((car) => {
                  const existingRenewal = activeRenewals[car.id];
                  return (
                    <div
                      key={car.id}
                      className="flex flex-col sm:flex-row gap-4 items-center p-4 border rounded-xl hover:bg-muted/50 transition-colors"
                    >
                      <div className="w-full sm:w-24 h-16 rounded-md bg-muted overflow-hidden flex-shrink-0">
                        {car.car_images?.[0] ? (
                          <img
                            src={
                              car.car_images[0].storage_path.startsWith("http")
                                ? car.car_images[0].storage_path
                                : supabase.storage
                                    .from("vehicle-documents")
                                    .getPublicUrl(car.car_images[0].storage_path)
                                    .data.publicUrl
                            }
                            alt={car.plate_number}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-secondary">
                            <CarIcon className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold">
                          {car.car_models?.car_brands?.name}{" "}
                          {car.car_models?.name}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          Plate:{" "}
                          <span className="font-mono">{car.plate_number}</span>
                        </p>
                        {car.status === "renewal_required" && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600">
                            <FileWarning className="h-3 w-3" /> Renewal required - offline until submitted
                          </span>
                        )}
                      </div>
                      <div>
                        {existingRenewal ? (
                          existingRenewal.status === "pending" ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium bg-amber-500/10 text-amber-500 rounded-full border border-amber-500/20">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                              Pending Review
                            </span>
                          ) : (
                            <div className="flex flex-col items-end gap-2">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium bg-red-500/10 text-red-500 rounded-full border border-red-500/20">
                                Rejected
                              </span>
                              <Button
                                size="sm"
                                onClick={() => selectCarForRenewal(car)}
                              >
                                Re-submit
                              </Button>
                            </div>
                          )
                        ) : (
                          <Button onClick={() => selectCarForRenewal(car)}>
                            {car.status === "renewal_required"
                              ? "Start Renewal"
                              : "Update Documents"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Button
            variant="ghost"
            onClick={() => setSelectedCar(null)}
            className="mb-2"
          >
            &larr; Back to List
          </Button>

          <Card className="border-primary/20 shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle>
                Renewal Submission: {selectedCar.plate_number}
              </CardTitle>
              <CardDescription>
                Confirm the new validity dates and upload the supporting
                documents. An admin reviews everything before the vehicle
                relists.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2 max-w-sm">
                  <Label>Current Vehicle Mileage (km)</Label>
                  <Input
                    type="number"
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    placeholder="e.g. 45000"
                    required
                  />
                </div>

                <div className="space-y-3 rounded-xl border p-4">
                  <h3 className="text-sm font-semibold">Registration &amp; Insurance Validity</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Registration expiry *</Label>
                      <Input
                        type="date"
                        min={new Date().toISOString().slice(0, 10)}
                        value={registrationExpiry}
                        onChange={(e) => setRegistrationExpiry(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>CTPL expiry *</Label>
                      <Input
                        type="date"
                        min={new Date().toISOString().slice(0, 10)}
                        value={ctplExpiry}
                        onChange={(e) => setCtplExpiry(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Comprehensive insurance expiry</Label>
                      <Input
                        type="date"
                        value={comprehensiveExpiry}
                        onChange={(e) => setComprehensiveExpiry(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional. Leave blank if you carry no comprehensive
                        policy.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-6">
                  {[
                    ...renewalDocs,
                    { key: "ctpl_document_path" as const, label: "CTPL document", optional: false },
                    {
                      key: "comprehensive_document_path" as const,
                      label: "Comprehensive insurance document",
                      optional: true,
                    },
                  ].map((doc) => (
                    <div key={doc.key} className="space-y-2">
                      <Label>
                        {doc.label}
                        {("optional" in doc && doc.optional) ? " (optional)" : " *"}
                      </Label>
                      <label
                        className={`flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                          files[doc.key]
                            ? "border-green-400 bg-green-50 dark:bg-green-950/20"
                            : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30"
                        }`}
                      >
                        {files[doc.key] ? (
                          <div className="text-center">
                            <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                            <p className="text-sm font-medium truncate max-w-[200px]">
                              {files[doc.key]!.name}
                            </p>
                          </div>
                        ) : (
                          <div className="text-center">
                            <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">
                              Select File
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Image or PDF (Max 10MB)
                            </p>
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) =>
                            handleFileChange(
                              doc.key,
                              e.target.files?.[0] || null,
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full sm:w-auto"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />{" "}
                        Uploading Documents...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" /> Submit Renewal
                        Requirements
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
