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
import { Plus, Trash2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { CarBrand, CarModel } from "@/types/database";

const bodyTypes = [
  "sedan",
  "suv",
  "hatchback",
  "van",
  "pickup",
  "coupe",
  "convertible",
  "wagon",
  "mpv",
];
const fuelTypes = ["gasoline", "diesel", "hybrid", "electric", "full electric"];

const defaultSeats: Record<string, number> = {
  sedan: 5,
  coupe: 4,
  hatchback: 5,
  suv: 7,
  van: 12,
  pickup: 5,
  convertible: 4,
  wagon: 5,
  mpv: 7,
};

export default function AdminCarCatalogPage() {
  const { user: adminUser } = useAuth();
  const [brands, setBrands] = useState<(CarBrand & { models: CarModel[] })[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

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
      if (bErr) throw bErr;
      if (mErr) throw mErr;

      if (brandsData && modelsData) {
        setBrands(
          brandsData.map((b) => ({
            ...b,
            models: modelsData.filter((m) => m.brand_id === b.id),
          })),
        );
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

  const handleDeleteModel = async (modelId: string, modelName: string) => {
    if (!confirm(`Delete model "${modelName}"?`)) return;
    const { error } = await supabase
      .from("car_models")
      .delete()
      .eq("id", modelId);
    if (error) toast.error("Failed to delete", { description: error.message });
    else {
      toast.success("Model deleted");
      fetchBrands();
    }
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
            "At least one registered car uses a model under this brand. Move or remove those cars first.",
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
          Manage car brands and models available for listing
        </p>
      </div>

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
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBrandDeleteTarget(brand);
                    }}
                    title="Delete brand"
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
                                  defaultSeats[
                                    v as keyof typeof defaultSeats
                                  ] || 5,
                              })
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {bodyTypes.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t
                                    .split(" ")
                                    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                                    .join(" ")}
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
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {brand.models.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-medium">
                              {m.name}
                            </TableCell>
                            <TableCell className="capitalize">
                              {m.body_type}
                            </TableCell>
                            <TableCell>{m.seats}</TableCell>
                            <TableCell className="capitalize">
                              {m.fuel_type}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-destructive"
                                onClick={() => handleDeleteModel(m.id, m.name)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
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
        open={Boolean(brandDeleteTarget)}
        title="Delete car brand?"
        description={
          brandDeleteTarget
            ? brandDeleteTarget.models.length > 0
              ? `This will delete "${brandDeleteTarget.name}" and ${brandDeleteTarget.models.length} unused model record(s). If any car is already registered under those models, SafeDrive will block the delete.`
              : `This will permanently delete "${brandDeleteTarget.name}".`
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
