import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  MapPin,
  Fuel,
  Users,
  Calendar,
  CarFront,
  Filter,
  Star,
  X,
} from "lucide-react";
import type { CarWithDetails } from "@/types/database";
import {
  fetchCarRatingSummaries,
  formatAverage,
  type RatingSummary,
} from "@/lib/ratings";

const MAX_PAYMENT_AMOUNT = 100000;
const CARS_PER_PAGE = 12;
const UNIVERSAL_FUEL_TYPES = ["gasoline", "diesel", "hybrid", "electric", "full electric"];

const titleCase = (value: string) =>
  value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function BrowseCarsPage() {
  const { profile } = useAuth();
  const [cars, setCars] = useState<CarWithDetails[]>([]);
  const [carRatings, setCarRatings] = useState<Record<string, RatingSummary>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [bodyTypeFilter, setBodyTypeFilter] = useState("all");

  // Advanced filters state
  const [brandFilter, setBrandFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [fuelTypeFilter, setFuelTypeFilter] = useState("all");
  const [seatsFilter, setSeatsFilter] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState("recommended");
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const navigate = useNavigate();
  const isVerified = profile?.verified_status === "verified";

  // Dynamic filter options based on available cars
  const brands = [
    "all",
    ...Array.from(new Set(cars.map((c) => c.car_models.car_brands.name))),
  ].sort();

  // Dynamic models based on selected brand
  const availableModels = cars
    .filter(
      (c) =>
        brandFilter === "all" || c.car_models.car_brands.name === brandFilter,
    )
    .map((c) => c.car_models.name);
  const models = ["all", ...Array.from(new Set(availableModels))].sort();

  const fuelTypes = [
    "all",
    ...Array.from(new Set([...UNIVERSAL_FUEL_TYPES, ...cars.map((c) => c.car_models.fuel_type)])),
  ].sort();
  const bodyTypes = [
    "all",
    ...Array.from(new Set(cars.map((c) => c.car_models.body_type))),
  ].sort();
  // Numeric sort for seats
  const seatOptions =
    bodyTypeFilter === "sedan"
      ? ["all", "4", "5"]
      : [
          "all",
          ...Array.from(new Set(cars.map((c) => c.car_models.seats.toString()))),
        ].sort((a, b) =>
          a === "all" ? -1 : b === "all" ? 1 : Number(a) - Number(b),
        );

  const resetFilters = () => {
    setSearchQuery("");
    setBodyTypeFilter("all");
    setBrandFilter("all");
    setModelFilter("all");
    setFuelTypeFilter("all");
    setSeatsFilter("all");
    setMinPrice("");
    setMaxPrice("");
    setSortBy("recommended");
    setCurrentPage(1);
  };

  const getSelectedLabel = (value: string, fallback: string) =>
    value === "all" ? fallback : titleCase(value);

  const getSortLabel = (value: string) => {
    switch (value) {
      case "price-low":
        return "Price: Low to High";
      case "price-high":
        return "Price: High to Low";
      case "newest":
        return "Newest Listings";
      default:
        return "Recommended";
    }
  };

  useEffect(() => {
    fetchCars();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    bodyTypeFilter,
    brandFilter,
    modelFilter,
    fuelTypeFilter,
    seatsFilter,
    minPrice,
    maxPrice,
    sortBy,
  ]);

  useEffect(() => {
    if (bodyTypeFilter === "sedan" && !["all", "4", "5"].includes(seatsFilter)) {
      setSeatsFilter("all");
    }
  }, [bodyTypeFilter, seatsFilter]);

  const fetchCars = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("cars")
        .select(
          `
          *,
          car_models!inner (
            *,
            car_brands!inner (*)
          ),
          car_images (*),
          profiles!cars_owner_id_fkey (full_name, phone, email)
        `,
        )
        .in("status", ["approved", "active"]);
      if (error) throw error;
      if (data) setCars(data as unknown as CarWithDetails[]);
    } catch (err) {
      console.error("Error fetching cars:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCarRatingSummaries().then(setCarRatings);
  }, []);

  const filteredCars = cars.filter((car) => {
    const matchesSearch =
      searchQuery === "" ||
      car.car_models.car_brands.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      car.car_models.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (car.location ?? "").toLowerCase().includes(searchQuery.toLowerCase());

    const matchesBodyType =
      bodyTypeFilter === "all" || car.car_models.body_type === bodyTypeFilter;
    const matchesBrand =
      brandFilter === "all" || car.car_models.car_brands.name === brandFilter;
    const matchesModel =
      modelFilter === "all" || car.car_models.name === modelFilter;
    const matchesFuelType =
      fuelTypeFilter === "all" || car.car_models.fuel_type === fuelTypeFilter;
    const matchesSeats =
      seatsFilter === "all" || car.car_models.seats.toString() === seatsFilter;
    const price = Number(car.price_per_day);
    const matchesMinPrice = minPrice === "" || price >= Number(minPrice);
    const cappedMaxPrice = maxPrice === "" ? "" : Math.min(Number(maxPrice), MAX_PAYMENT_AMOUNT);
    const matchesMaxPrice = cappedMaxPrice === "" || price <= cappedMaxPrice;

    return (
      matchesSearch &&
      matchesBodyType &&
      matchesBrand &&
      matchesModel &&
      matchesFuelType &&
      matchesSeats &&
      matchesMinPrice &&
      matchesMaxPrice
    );
  }).sort((a, b) => {
    if (sortBy === "price-low") {
      return Number(a.price_per_day) - Number(b.price_per_day);
    }
    if (sortBy === "price-high") {
      return Number(b.price_per_day) - Number(a.price_per_day);
    }
    if (sortBy === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return 0;
  });
  const totalPages = Math.max(1, Math.ceil(filteredCars.length / CARS_PER_PAGE));
  const pageStart = (currentPage - 1) * CARS_PER_PAGE;
  const pagedCars = filteredCars.slice(pageStart, pageStart + CARS_PER_PAGE);

  const getCarImageUrl = (car: CarWithDetails) => {
    const primary = car.car_images?.find((img) => img.is_primary);
    const path = primary?.storage_path || car.car_images?.[0]?.storage_path;
    if (path) {
      // backwards compat: old entries stored the full public URL
      if (path.startsWith("http")) return path;
      const { data } = supabase.storage
        .from("vehicle-documents")
        .getPublicUrl(path);
      return data.publicUrl;
    }
    return null;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Browse Cars</h1>
        <p className="text-muted-foreground mt-1">
          Find the perfect car for your next trip
        </p>
      </div>

      {!isVerified && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              You can browse cars while unverified.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Booking is disabled until your identity verification is complete.
              Continue to verification when you're ready.
            </p>
          </div>
          <Button
            className="shrink-0"
            onClick={() => navigate("/verify")}
          >
            Verify Account
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search brand, model, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
          <Button
            variant={showFilters ? "secondary" : "outline"}
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2 h-10 shrink-0"
          >
            <Filter className="w-4 h-4" />
            Filters{" "}
            {(!["all"].includes(bodyTypeFilter) ||
              !["all"].includes(brandFilter) ||
              !["all"].includes(modelFilter) ||
              !["all"].includes(fuelTypeFilter) ||
              !["all"].includes(seatsFilter) ||
              minPrice !== "" ||
              maxPrice !== "" ||
              sortBy !== "recommended") &&
              "(Active)"}
          </Button>
          {(searchQuery !== "" ||
            bodyTypeFilter !== "all" ||
            brandFilter !== "all" ||
            modelFilter !== "all" ||
            fuelTypeFilter !== "all" ||
            seatsFilter !== "all" ||
            minPrice !== "" ||
            maxPrice !== "" ||
            sortBy !== "recommended") && (
            <Button
              variant="ghost"
              className="h-10 shrink-0 px-2"
              onClick={resetFilters}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Expandable Advanced Filters */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-muted/30 rounded-lg border animate-in slide-in-from-top-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Brand</p>
              <Select
                value={brandFilter}
                onValueChange={(val) => {
                  setBrandFilter(val || "all");
                  setModelFilter("all");
                }}
              >
                <SelectTrigger className="h-10 w-full">
                  <span>{brandFilter === "all" ? "Any Brand" : brandFilter}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Brand</SelectItem>
                  {brands
                    .filter((b) => b !== "all")
                    .map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Model</p>
              <Select
                value={modelFilter}
                onValueChange={(val) => setModelFilter(val || "all")}
              >
                <SelectTrigger className="h-10 w-full">
                  <span>{modelFilter === "all" ? "Any Model" : modelFilter}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Model</SelectItem>
                  {models
                    .filter((m) => m !== "all")
                    .map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Body Type</p>
              <Select
                value={bodyTypeFilter}
                onValueChange={(val) => {
                  setBodyTypeFilter(val || "all");
                  if (val === "sedan" && !["all", "4", "5"].includes(seatsFilter)) {
                    setSeatsFilter("all");
                  }
                }}
              >
                <SelectTrigger className="h-10 w-full">
                  <span>{getSelectedLabel(bodyTypeFilter, "Any Body Type")}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Body Type</SelectItem>
                  {bodyTypes
                    .filter((t) => t !== "all")
                    .map((type) => (
                      <SelectItem key={type} value={type}>
                        {titleCase(type)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Seats</p>
              <Select
                value={seatsFilter}
                onValueChange={(val) => setSeatsFilter(val || "all")}
              >
                <SelectTrigger className="h-10 w-full">
                  <span>{seatsFilter === "all" ? "Any Seat Count" : `${seatsFilter} Seats`}</span>
                </SelectTrigger>
                <SelectContent>
                  {seatOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "Any Seat Count" : `${s} Seats`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Fuel Type</p>
              <Select
                value={fuelTypeFilter}
                onValueChange={(val) => setFuelTypeFilter(val || "all")}
              >
                <SelectTrigger className="h-10 w-full">
                  <span>{getSelectedLabel(fuelTypeFilter, "Any Fuel Type")}</span>
                </SelectTrigger>
                <SelectContent>
                  {fuelTypes.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f === "all" ? "Any Fuel Type" : titleCase(f)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Minimum Price</p>
              <Input
                type="number"
                min="0"
                max={MAX_PAYMENT_AMOUNT}
                value={minPrice}
                onChange={(e) => {
                  const value = e.target.value;
                  setMinPrice(value === "" ? "" : String(Math.min(Number(value), MAX_PAYMENT_AMOUNT)));
                }}
                placeholder="No minimum"
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Maximum Price</p>
              <Input
                type="number"
                min="0"
                max={MAX_PAYMENT_AMOUNT}
                value={maxPrice}
                onChange={(e) => {
                  const value = e.target.value;
                  setMaxPrice(value === "" ? "" : String(Math.min(Number(value), MAX_PAYMENT_AMOUNT)));
                }}
                placeholder="Max PHP 100,000"
                className="h-10"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Sort By</p>
              <Select value={sortBy} onValueChange={(val) => setSortBy(val || "recommended")}>
                <SelectTrigger className="h-10 w-full">
                  <span>{getSortLabel(sortBy)}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recommended">Recommended</SelectItem>
                  <SelectItem value="price-low">Price: Low to High</SelectItem>
                  <SelectItem value="price-high">Price: High to Low</SelectItem>
                  <SelectItem value="newest">Newest Listings</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {loading
          ? "Loading..."
          : `${filteredCars.length} car${filteredCars.length !== 1 ? "s" : ""} found`}
        {!loading && filteredCars.length > CARS_PER_PAGE
          ? ` - page ${currentPage} of ${totalPages}`
          : ""}
      </p>

      {/* Car Grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-48 w-full rounded-none" />
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredCars.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <CarFront className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold mb-1">No cars found</h3>
          <p className="text-muted-foreground text-sm mb-6">
            We couldn't find any cars matching your current filters.
          </p>
          <Button
            onClick={resetFilters}
            variant="outline"
            className="rounded-xl shadow-sm"
          >
            <X className="w-4 h-4 mr-2" />
            Clear All Filters
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {pagedCars.map((car, i) => {
            const imageUrl = getCarImageUrl(car);
            return (
              <Card
                key={car.id}
                className="group overflow-hidden cursor-pointer hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:border-primary/20 animate-fade-in"
                style={{ animationDelay: `${i * 0.05}s` }}
                onClick={() => navigate(`/cars/${car.id}`)}
              >
                {/* Image */}
                <div className="relative h-48 bg-muted overflow-hidden">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={`${car.car_models.car_brands.name} ${car.car_models.name}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <CarFront className="w-16 h-16 text-muted-foreground/20" />
                    </div>
                  )}
                  <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-background/90 backdrop-blur-sm text-xs font-semibold shadow-sm">
                    ₱{Number(car.price_per_day).toLocaleString()}/day
                  </div>
                  {profile?.id === car.owner_id ? (
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-sm">
                      Your listing
                    </div>
                  ) : null}
                </div>

                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
                      {car.car_models.car_brands.name} {car.car_models.name}
                    </h3>
                    {carRatings[car.id]?.count ? (
                      <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium text-foreground">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {formatAverage(carRatings[car.id].average)}
                        <span className="text-muted-foreground">
                          ({carRatings[car.id].count})
                        </span>
                      </span>
                    ) : (
                      <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                        New
                      </span>
                    )}
                  </div>
                  <div className="mt-2 inline-flex max-w-full items-center rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                    <span className="mr-1">Plate</span>
                    <span className="truncate font-mono font-medium text-foreground">
                      {car.plate_number}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CarFront className="w-3.5 h-3.5" />
                      {car.car_models.body_type.charAt(0).toUpperCase() +
                        car.car_models.body_type.slice(1)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {car.car_models.seats} seats
                    </span>
                    <span className="flex items-center gap-1">
                      <Fuel className="w-3.5 h-3.5" />
                      {car.car_models.fuel_type.charAt(0).toUpperCase() +
                        car.car_models.fuel_type.slice(1)}
                    </span>
                    {car.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {car.location}
                      </span>
                    )}
                  </div>

                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      View & Book
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {!loading && filteredCars.length > CARS_PER_PAGE && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Showing {pageStart + 1}-{Math.min(pageStart + CARS_PER_PAGE, filteredCars.length)} of {filteredCars.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm font-medium">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
