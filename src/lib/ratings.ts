import { supabase } from "@/lib/supabase";

export type RatingSummary = { average: number; count: number };

export type ListerRating = RatingSummary & { tripCount: number };

export type PublicCarReview = {
  id: string;
  rating: number;
  feedback: string | null;
  created_at: string;
  reviewer_name: string;
  reviewer_avatar: string | null;
  is_cancellation_review?: boolean;
};

export type Reliability = {
  completedTrips: number;
  cancellations: number;
  lateCancellations: number;
  /** Percent (0-100), or null until there is enough history to show one. */
  cancellationRate: number | null;
  hasEnoughHistory: boolean;
};

export type RenterReputation = {
  average: number | null;
  reviewCount: number;
  tripCount: number;
  recent: Array<{ rating: number; feedback: string | null; created_at: string }>;
};

/** "4.8" with one decimal, or null when there is nothing to show. */
export const formatAverage = (average: number | null | undefined) =>
  typeof average === "number" && Number.isFinite(average)
    ? average.toFixed(1)
    : null;

/** Car ratings keyed by car id. Aggregate of renter -> trip reviews. */
export const fetchCarRatingSummaries = async (): Promise<
  Record<string, RatingSummary>
> => {
  try {
    const { data, error } = await supabase.rpc("get_car_rating_summaries");
    if (error) throw error;
    const map: Record<string, RatingSummary> = {};
    for (const row of (data ?? []) as Array<{
      car_id: string;
      average: number | string;
      review_count: number;
    }>) {
      map[row.car_id] = {
        average: Number(row.average) || 0,
        count: Number(row.review_count) || 0,
      };
    }
    return map;
  } catch (err) {
    console.error("Failed to load car rating summaries:", err);
    return {};
  }
};

/** Lister ratings keyed by lister (owner) id. Same rows as the car rating,
 * grouped by the person instead of the car. */
export const fetchListerRatingSummaries = async (): Promise<
  Record<string, ListerRating>
> => {
  try {
    const { data, error } = await supabase.rpc("get_lister_rating_summaries");
    if (error) throw error;
    const map: Record<string, ListerRating> = {};
    for (const row of (data ?? []) as Array<{
      lister_id: string;
      average: number | string;
      review_count: number;
      trip_count: number;
    }>) {
      map[row.lister_id] = {
        average: Number(row.average) || 0,
        count: Number(row.review_count) || 0,
        tripCount: Number(row.trip_count) || 0,
      };
    }
    return map;
  } catch (err) {
    console.error("Failed to load lister rating summaries:", err);
    return {};
  }
};

export const fetchPublicCarReviews = async (
  carId: string,
): Promise<PublicCarReview[]> => {
  try {
    const { data, error } = await supabase.rpc("get_public_car_reviews", {
      p_car_id: carId,
    });
    if (error) throw error;
    return (data ?? []) as PublicCarReview[];
  } catch (err) {
    console.error("Failed to load car reviews:", err);
    return [];
  }
};

const parseReliability = (raw: unknown): Reliability => {
  const row = (raw ?? {}) as {
    completed_trips?: number;
    cancellations?: number;
    late_cancellations?: number;
    cancellation_rate?: number | string | null;
    has_enough_history?: boolean;
  };
  const rate =
    row.cancellation_rate === null || row.cancellation_rate === undefined
      ? null
      : Number(row.cancellation_rate);
  return {
    completedTrips: Number(row.completed_trips) || 0,
    cancellations: Number(row.cancellations) || 0,
    lateCancellations: Number(row.late_cancellations) || 0,
    cancellationRate: rate !== null && Number.isFinite(rate) ? rate : null,
    hasEnoughHistory: Boolean(row.has_enough_history),
  };
};

const EMPTY_RELIABILITY: Reliability = {
  completedTrips: 0,
  cancellations: 0,
  lateCancellations: 0,
  cancellationRate: null,
  hasEnoughHistory: false,
};

/** Lister reliability (rolling 365 days): completed trips vs cancellations. */
export const fetchListerReliability = async (
  listerId: string,
): Promise<Reliability> => {
  try {
    const { data, error } = await supabase.rpc("get_lister_reliability", {
      p_lister_id: listerId,
    });
    if (error) throw error;
    return parseReliability(data);
  } catch (err) {
    console.error("Failed to load lister reliability:", err);
    return EMPTY_RELIABILITY;
  }
};

/** Renter reliability (rolling 365 days): completed trips vs late cancellations. */
export const fetchRenterReliability = async (
  renterId: string,
): Promise<Reliability> => {
  try {
    const { data, error } = await supabase.rpc("get_renter_reliability", {
      p_renter_id: renterId,
    });
    if (error) throw error;
    return parseReliability(data);
  } catch (err) {
    console.error("Failed to load renter reliability:", err);
    return EMPTY_RELIABILITY;
  }
};

export const fetchRenterReputation = async (
  renterId: string,
): Promise<RenterReputation> => {
  const empty: RenterReputation = {
    average: null,
    reviewCount: 0,
    tripCount: 0,
    recent: [],
  };
  try {
    const { data, error } = await supabase.rpc("get_renter_reputation", {
      p_renter_id: renterId,
    });
    if (error) throw error;
    const row = (data ?? {}) as {
      average?: number | string | null;
      review_count?: number;
      trip_count?: number;
      recent?: RenterReputation["recent"];
    };
    return {
      average:
        row.average === null || row.average === undefined
          ? null
          : Number(row.average) || 0,
      reviewCount: Number(row.review_count) || 0,
      tripCount: Number(row.trip_count) || 0,
      recent: Array.isArray(row.recent) ? row.recent : [],
    };
  } catch (err) {
    console.error("Failed to load renter reputation:", err);
    return empty;
  }
};
