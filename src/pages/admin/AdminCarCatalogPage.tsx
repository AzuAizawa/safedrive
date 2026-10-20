import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Archive,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { BodyType, CarBrand, CarModel } from "@/types/database";

/**
 * Deleting versus discontinuing.
 *
 * cars.model_id references car_models(id) with no ON DELETE clause, so a model
 * any car points at cannot be removed - booked or not. A delete therefore only
 * ever succeeds on an entry no listing uses, which is the entry added by
 * mistake five minutes ago. That is the only thing Delete is for.
 *
 * Everything else is discontinued (CHAPTER 84): the row stays, every listing
 * and booking that points at it keeps resolving, and it stops being offered
 * when a lister picks a brand and model for a new car. This is the ordinary
 * way a catalog entry leaves - the standard for reference data, and the only
 * one that does not destroy history.
 */
type CatalogEntry = { discontinued_at?: string | null };

const isDiscontinued = (entry: CatalogEntry) => Boolean(entry.discontinued_at);

const fuelTypes = ["gasoline", "diesel", "hybrid", "electric", "full electric"];

const titleCase = (value: string) =>
  value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function AdminCarCatalogPage() {
  const { user: adminUser } = useAuth();
  const [brands, setBrands] = useState<(CarBrand & { models: CarModel[] })[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

  // Body types are catalog entries too (CHAPTER 126): added, discontinued, and
  // deleted only while no model uses one.
  const [bodyTypes, setBodyTypes] = useState<BodyType[]>([]);
  const [newBodyTypeName, setNewBodyTypeName] = useState("");
  const [newBodyTypeSeats, setNewBodyTypeSeats] = useState(5);
  const [addingBodyType, setAddingBodyType] = useState(false);
  const [bodyTypeDeleteTarget, setBodyTypeDeleteTarget] = useState<BodyType | null>(null);
  const [bodyTypeDeleteLoading, setBodyTypeDeleteLoading] = useState(false);

  // Add brand form
  const [newBrandName, setNewBrandName] = useState("");
  const [addingBrand, setAddingBrand] = useState(false);

  // Add model form
  const [showModelForm, setShowModelForm] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<{
    name: string;
    body_type: string;
    seats: number;
    fuel_type: string;
  }>({ name: "", body_type: "sedan", seats: 5, fuel_type: "gasoline" });
  const [addingModel, setAddingModel] = useState(false);
  const [brandDeleteTarget, setBrandDeleteTarget] = useState<
    (CarBrand & { models: CarModel[] }) | null
  >(null);
  const [deleteBrandLoading, setDeleteBrandLoading] = useState(false);
  // How many registered cars use each model. Loaded with the catalog so the
  // page can say what will happen before a button is pressed, rather than
  // after the database refuses.
  const [modelUsage, setModelUsage] = useState<Record<string, number>>({});
  const [modelDeleteTarget, setModelDeleteTarget] = useState<CarModel | null>(null);
  const [modelDeleteLoading, setModelDeleteLoading] = useState(false);
  const [discontinuingId, setDiscontinuingId] = useState<string | null>(null);

  useEffect(() => {
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    setLoading(true);
    try {
      const { data: brandsData, error: bErr } = await supabase
        .from("car_brands")
        .select("*")
        .order("name");
      const { data: modelsData, error: mErr } = await supabase
        .from("car_models")
        .select("*")
        .order("name");
      const { data: typesData, error: tErr } = await supabase
        .from("body_types")
        .select("*")
        .order("name");
      if (bErr) throw bErr;
      if (mErr) throw mErr;
      if (tErr) throw tErr;
      setBodyTypes(typesData ?? []);

      if (brandsData && modelsData) {
        setBrands(
          brandsData.map((b) => ({
            ...b,
            models: modelsData.filter((m) => m.brand_id === b.id),
          })),
        );

        const { data: carRows, error: carErr } = await supabase
          .from("cars")
          .select("model_id");
        if (carErr) {
          console.error("Could not count catalog usage:", carErr);
          setModelUsage({});
        } else {
          const counts: Record<string, number> = {};
          for (const row of (carRows ?? []) as { model_id: string }[]) {
            counts[row.model_id] = (counts[row.model_id] ?? 0) + 1;
          }
          setModelUsage(counts);
        }
      }
    } catch (err) {
      console.error("Failed to load brands:", err);
      toast.error("Failed to load car catalog");
    } finally {
      setLoading(false);
    }
  };

  const handleAddBrand = async () => {
    if (!newBrandName.trim() || !adminUser) return;
    setAddingBrand(true);
    const { error } = await supabase
      .from("car_brands")
      .insert({ name: newBrandName.trim() });
    if (error) {
      toast.error("Failed to add brand", { description: error.message });
    } else {
      await supabase
        .from("audit_log")
        .insert({
          user_id: adminUser.id,
          action: "admin_added_car_brand",
          entity_type: "car_brand",
          details: { name: newBrandName.trim() },
        });
      toast.success(`Brand "${newBrandName.trim()}" added!`);
      setNewBrandName("");
      fetchBrands();
    }
    setAddingBrand(false);
  };

  /** How many catalog models name each body type. A type in use cannot be deleted. */
  const bodyTypeUsage = brands
    .flatMap((brand) => brand.models)
    .reduce<Record<string, number>>((counts, model) => {
      counts[model.body_type] = (counts[model.body_type] ?? 0) + 1;
      return counts;
    }, {});

  const handleAddBodyType = async () => {
    const name = newBodyTypeName.trim().toLowerCase().replace(/\s+/g, " ");
    if (!name || !adminUser) return;
    setAddingBodyType(true);
    const { error } = await supabase
      .from("body_types")
      .insert({ name, default_seats: newBodyTypeSeats });
    setAddingBodyType(false);
    if (error) {
      toast.error("Failed to add body type", {
        description:
          String((error as { code?: unknown }).code) === "23505"
            ? `"${titleCase(name)}" is already on the list.`
            : error.message,
      });
      return;
    }
    await supabase.from("audit_log").insert({
      user_id: adminUser.id,
      action: "admin_added_body_type",
      entity_type: "body_type",
      details: { name, default_seats: newBodyTypeSeats },
    });
    toast.success(`Body type "${titleCase(name)}" added!`);
    setNewBodyTypeName("");
    setNewBodyTypeSeats(5);
    fetchBrands();
  };

  const toggleBodyTypeDiscontinued = async (bodyType: BodyType) => {
    setDiscontinuingId(`body:${bodyType.name}`);
    const { error } = await supabase
      .from("body_types")
      .update({
        discontinued_at: isDiscontinued(bodyType) ? null : new Date().toISOString(),
      })
      .eq("name", bodyType.name);
    setDiscontinuingId(null);
    if (error) {
      toast.error("Could not update this body type", { description: error.message });
      return;
    }
    toast.success(
      isDiscontinued(bodyType)
        ? `"${titleCase(bodyType.name)}" is offered again.`
        : `"${titleCase(bodyType.name)}" is no longer offered for new models. Existing models keep it.`,
    );
    fetchBrands();
  };

  const handleDeleteBodyType = async () => {
    if (!bodyTypeDeleteTarget) return;
    setBodyTypeDeleteLoading(true);
    const { error } = await supabase
      .from("body_types")
      .delete()
      .eq("name", bodyTypeDeleteTarget.name);
    setBodyTypeDeleteLoading(false);
    setBodyTypeDeleteTarget(null);
    if (error) {
      toast.error("Body type was not deleted", {
        description:
          String((error as { code?: unknown }).code) === "23503"
            ? "A model uses this body type, so it cannot be deleted. Discontinue it instead."
            : error.message,
      });
      return;
    }
    toast.success("Body type deleted");
    fetchBrands();
  };

  const handleAddModel = async (brandId: string) => {
    if (!modelForm.name.trim() || !adminUser) return;
    setAddingModel(true);
    const { error } = await supabase.from("car_models").insert({
      brand_id: brandId,
      name: modelForm.name.trim(),
      body_type: modelForm.body_type,
      seats: modelForm.seats,
      fuel_type: modelForm.fuel_type,
    });
    if (error) {
      toast.error("Failed to add model", { description: error.message });
    } else {
      await supabase
        .from("audit_log")
        .insert({
          user_id: adminUser.id,
          action: "admin_added_car_model",
          entity_type: "car_model",
          details: { name: modelForm.name.trim(), brand_id: brandId },
        });
      toast.success(`Model "${modelForm.name.trim()}" added!`);
      setModelForm({
        name: "",
        body_type: "sedan",
        seats: 5,
        fuel_type: "gasoline",
      });
      setShowModelForm(null);
      fetchBrands();
    }
    setAddingModel(false);
  };

  /** Read a message off a Supabase error, which is a plain object, not an Error. */
  /** True when any listing depends on a model under this brand. */
  const brandIsInUse = (brand: CarBrand & { models: CarModel[] }) =>
    brand.models.some((model) => (modelUsage[model.id] ?? 0) > 0);

  const errorMessage = (error: unknown) =>
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : error instanceof Error
        ? error.message
        : "";

  const toggleBrandDiscontinued = async (
    brand: CarBrand & { models: CarModel[] },
  ) => {
    setDiscontinuingId(brand.id);
    // One call, one transaction: a brand and its models must never disagree,
    // or a lister picks a brand and finds nothing under it.
    const { error } = await supabase.rpc("set_brand_discontinued", {
      p_brand_id: brand.id,
      p_discontinued: !isDiscontinued(brand),
    });
    setDiscontinuingId(null);
    if (error) {
      toast.error("Could not update this brand", { description: error.message });
      return;
    }
    toast.success(
      isDiscontinued(brand)
        ? `"${brand.name}" is offered again.`
        : `"${brand.name}" and its models are no longer offered. Existing listings keep working.`,
    );
    fetchBrands();
  };

  const toggleModelDiscontinued = async (model: CarModel) => {
    setDiscontinuingId(model.id);
    const { error } = await supabase
      .from("car_models")
      .update({
        discontinued_at: isDiscontinued(model) ? null : new Date().toISOString(),
      })
      .eq("id", model.id);
    setDiscontinuingId(null);
    if (error) {
      toast.error("Could not update this model", { description: error.message });
      return;
    }
    toast.success(
      isDiscontinued(model)
        ? `"${model.name}" is offered again.`
        : `"${model.name}" is no longer offered. Existing listings keep working.`,
    );
    fetchBrands();
  };

  const handleDeleteModel = async () => {
    if (!modelDeleteTarget) return;
    setModelDeleteLoading(true);
    const { error } = await supabase
      .from("car_models")
      .delete()
      .eq("id", modelDeleteTarget.id);
    setModelDeleteLoading(false);
    setModelDeleteTarget(null);
    if (error) {
      const raw = errorMessage(error);
      const inUse =
        String((error as { code?: unknown }).code) === "23503" ||
        raw.includes("violates foreign key constraint");
      toast.error("Model was not deleted", {
        description: inUse
          ? "A registered car uses this model, so it cannot be deleted. Discontinue it instead - existing listings keep working and it stops being offered."
          : raw || "Please try again.",
      });
      return;
    }
    toast.success("Model deleted");
    fetchBrands();
  };

  const handleDeleteBrand = async () => {
    if (!brandDeleteTarget || !adminUser) return;

    setDeleteBrandLoading(true);
    const modelIds = brandDeleteTarget.models.map((model) => model.id);

    if (modelIds.length > 0) {
      const { count, error: countError } = await supabase
        .from("cars")
        .select("id", { count: "exact", head: true })
        .in("model_id", modelIds);

      if (countError) {
        toast.error("Could not check brand usage", {
          description: countError.message,
        });
        setDeleteBrandLoading(false);
        return;
      }

      if ((count ?? 0) > 0) {
        toast.error("Brand cannot be deleted", {
          description:
            "A registered car uses a model under this brand, and deleting it would take that model with it. Discontinue the brand instead - every existing listing keeps working, and it stops being offered to new ones.",
        });
        setDeleteBrandLoading(false);
        setBrandDeleteTarget(null);
        return;
      }
    }

    const { error } = await supabase
      .from("car_brands")
      .delete()
      .eq("id", brandDeleteTarget.id);

    if (error) {
      toast.error("Failed to delete brand", { description: error.message });
    } else {
      await supabase.from("audit_log").insert({
        user_id: adminUser.id,
        action: "admin_deleted_car_brand",
        entity_type: "car_brand",
        entity_id: brandDeleteTarget.id,
        details: {
          name: brandDeleteTarget.name,
          deleted_models: brandDeleteTarget.models.length,
        },
      });
      toast.success(`Brand "${brandDeleteTarget.name}" deleted.`);
      setBrandDeleteTarget(null);
      fetchBrands();
    }

    setDeleteBrandLoading(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Car Catalog</h1>
        <p className="text-muted-foreground mt-1">
          Manage body types, car brands and models available for listing
        </p>
      </div>

      {/* Body types */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <h2 className="font-semibold">Body Types</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Picked for each model. Default seats fill the model form and can be changed there.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="New body type (e.g., utility van)"
              value={newBodyTypeName}
              onChange={(e) => setNewBodyTypeName(e.target.value)}
              className="h-10 min-w-0 flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleAddBodyType()}
            />
            <div className="flex shrink-0 gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">Default seats</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={newBodyTypeSeats}
                  onChange={(e) =>
                    setNewBodyTypeSeats(
                      Math.min(60, Math.max(1, parseInt(e.target.value) || 1)),
                    )
                  }
                  className="h-10 w-20"
                />
              </div>
              <Button
                onClick={handleAddBodyType}
                disabled={addingBodyType || !newBodyTypeName.trim()}
                className="gap-2 shrink-0"
              >
                {addingBodyType ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add Body Type
              </Button>
            </div>
          </div>
          {bodyTypes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {bodyTypes.map((t) => {
                const used = bodyTypeUsage[t.name] ?? 0;
                return (
                  <div
                    key={t.name}
                    className="flex items-center gap-1.5 rounded-md border border-border py-1 pl-3 pr-1 text-sm"
                  >
                    <span className="font-medium">{titleCase(t.name)}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {t.default_seats} seats · {used} model{used === 1 ? "" : "s"}
                    </span>
                    {isDiscontinued(t) && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Discontinued
                      </span>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={discontinuingId === `body:${t.name}`}
                      onClick={() => void toggleBodyTypeDiscontinued(t)}
                      title={
                        isDiscontinued(t)
                          ? "Offer this body type again"
                          : "Stop offering this body type for new models. Existing models keep it."
                      }
                    >
                      {discontinuingId === `body:${t.name}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isDiscontinued(t) ? (
                        <RotateCcw className="w-3.5 h-3.5" />
                      ) : (
                        <Archive className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      disabled={used > 0}
                      onClick={() => setBodyTypeDeleteTarget(t)}
                      title={
                        used > 0
                          ? "Models use this body type, so it cannot be deleted. Discontinue it instead."
                          : "Delete body type"
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Brand */}
      <Card>
        <CardContent className="p-4 flex gap-3">
          <Input
            placeholder="New brand name (e.g., Hyundai)"
            value={newBrandName}
            onChange={(e) => setNewBrandName(e.target.value)}
            className="h-10"
            onKeyDown={(e) => e.key === "Enter" && handleAddBrand()}
          />
          <Button
            onClick={handleAddBrand}
            disabled={addingBrand || !newBrandName.trim()}
            className="gap-2 shrink-0"
          >
            {addingBrand ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Add Brand
          </Button>
        </CardContent>
      </Card>

      {/* Brands list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-6 w-32 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : brands.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">
          No brands yet. Add one above.
        </p>
      ) : (
        <div className="space-y-3">
          {brands.map((brand) => (
            <Card key={brand.id}>
              <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() =>
                  setExpandedBrand(expandedBrand === brand.id ? null : brand.id)
                }
              >
                <div className="flex items-center gap-3">
                  {expandedBrand === brand.id ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <h3 className="font-semibold">{brand.name}</h3>
                  <span className="text-xs text-muted-foreground">
                    ({brand.models.length} models)
                  </span>
                  {isDiscontinued(brand) && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Discontinued
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowModelForm(
                        showModelForm === brand.id ? null : brand.id,
                      );
                      setExpandedBrand(brand.id);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Model
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={discontinuingId === brand.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleBrandDiscontinued(brand);
                    }}
                    title={
                      isDiscontinued(brand)
                        ? "Offer this brand again"
                        : "Stop offering this brand for new cars. Existing listings keep working."
                    }
                  >
                    {discontinuingId === brand.id ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : isDiscontinued(brand) ? (
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    ) : (
                      <Archive className="w-3.5 h-3.5 mr-1" />
                    )}
                    {isDiscontinued(brand) ? "Restore" : "Discontinue"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    disabled={brandIsInUse(brand)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setBrandDeleteTarget(brand);
                    }}
                    title={
                      brandIsInUse(brand)
                        ? "Registered cars use this brand, so it cannot be deleted. Discontinue it instead."
                        : "Delete brand"
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {expandedBrand === brand.id && (
                <div className="border-t border-border">
                  {/* Add model form */}
                  {showModelForm === brand.id && (
                    <div className="p-4 bg-muted/30 border-b border-border">
                      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Model Name</Label>
                          <Input
                            value={modelForm.name}
                            onChange={(e) =>
                              setModelForm({
                                ...modelForm,
                                name: e.target.value,
                              })
                            }
                            placeholder="e.g., Tucson"
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Body Type</Label>
                          <Select
                            value={modelForm.body_type || "sedan"}
                            onValueChange={(v) =>
                              setModelForm({
                                ...modelForm,
                                body_type: v as string,
                                seats:
                                  bodyTypes.find((t) => t.name === v)
                                    ?.default_seats || 5,
                              })
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {bodyTypes
                                .filter((t) => !isDiscontinued(t))
                                .map((t) => (
                                  <SelectItem key={t.name} value={t.name}>
                                    {titleCase(t.name)}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Seats (auto)</Label>
                          <Input
                            type="number"
                            value={modelForm.seats}
                            onChange={(e) =>
                              setModelForm({
                                ...modelForm,
                                seats: parseInt(e.target.value) || 5,
                              })
                            }
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Fuel Type</Label>
                          <Select
                            value={modelForm.fuel_type || "gasoline"}
                            onValueChange={(v) =>
                              setModelForm({
                                ...modelForm,
                                fuel_type: v as string,
                              })
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {fuelTypes.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t.charAt(0).toUpperCase() + t.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            onClick={() => handleAddModel(brand.id)}
                            disabled={addingModel || !modelForm.name.trim()}
                            className="h-9 w-full gap-1"
                          >
                            {addingModel ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Plus className="w-3.5 h-3.5" />
                            )}
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {brand.models.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      No models for this brand yet.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Model</TableHead>
                          <TableHead>Body Type</TableHead>
                          <TableHead>Seats</TableHead>
                          <TableHead>Fuel</TableHead>
                          <TableHead className="w-56 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {brand.models.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-medium">
                              <span className="flex flex-wrap items-center gap-2">
                                {m.name}
                                {isDiscontinued(m) && (
                                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                    Discontinued
                                  </span>
                                )}
                                {(modelUsage[m.id] ?? 0) > 0 && (
                                  <span className="text-[10px] font-normal text-muted-foreground">
                                    {modelUsage[m.id]} listing
                                    {modelUsage[m.id] === 1 ? "" : "s"}
                                  </span>
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="capitalize">
                              {m.body_type}
                            </TableCell>
                            <TableCell>{m.seats}</TableCell>
                            <TableCell className="capitalize">
                              {m.fuel_type}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={discontinuingId === m.id}
                                  onClick={() => void toggleModelDiscontinued(m)}
                                  title={
                                    isDiscontinued(m)
                                      ? "Offer this model again"
                                      : "Stop offering this model for new cars. Existing listings keep working."
                                  }
                                >
                                  {discontinuingId === m.id ? (
                                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                  ) : isDiscontinued(m) ? (
                                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                  ) : (
                                    <Archive className="w-3.5 h-3.5 mr-1" />
                                  )}
                                  {isDiscontinued(m) ? "Restore" : "Discontinue"}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive"
                                  disabled={(modelUsage[m.id] ?? 0) > 0}
                                  onClick={() => setModelDeleteTarget(m)}
                                  title={
                                    (modelUsage[m.id] ?? 0) > 0
                                      ? "Registered cars use this model, so it cannot be deleted. Discontinue it instead."
                                      : "Delete model"
                                  }
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(modelDeleteTarget)}
        title="Delete this model?"
        description={
          modelDeleteTarget
            ? `"${modelDeleteTarget.name}" has never been used by a listing, so deleting it removes a catalog entry and nothing else. If you only want to stop offering it, use Discontinue instead.`
            : ""
        }
        confirmText="Delete Model"
        destructive
        isLoading={modelDeleteLoading}
        onConfirm={handleDeleteModel}
        onCancel={() => setModelDeleteTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(bodyTypeDeleteTarget)}
        title="Delete this body type?"
        description={
          bodyTypeDeleteTarget
            ? `No model uses "${titleCase(bodyTypeDeleteTarget.name)}", so deleting it removes a catalog entry and nothing else. If you only want to stop offering it, use Discontinue instead.`
            : ""
        }
        confirmText="Delete Body Type"
        destructive
        isLoading={bodyTypeDeleteLoading}
        onConfirm={handleDeleteBodyType}
        onCancel={() => setBodyTypeDeleteTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(brandDeleteTarget)}
        title="Delete car brand?"
        description={
          brandDeleteTarget
            ? brandDeleteTarget.models.length > 0
              ? `This deletes "${brandDeleteTarget.name}" and its ${brandDeleteTarget.models.length} model record(s) outright - no listing uses any of them, so nothing else is affected. To stop offering the brand while keeping its records, use Discontinue instead.`
              : `This permanently deletes "${brandDeleteTarget.name}". No models exist under it.`
            : ""
        }
        confirmText="Delete Brand"
        destructive
        isLoading={deleteBrandLoading}
        onConfirm={handleDeleteBrand}
        onCancel={() => setBrandDeleteTarget(null)}
      />
    </div>
  );
}
