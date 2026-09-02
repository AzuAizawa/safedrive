export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: "14.4";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          first_name: string | null;
          middle_name: string | null;
          last_name: string | null;
          phone: string | null;
          secondary_phone: string | null;
          address: string | null;
          birthday: string | null;
          driver_license: string | null;
          national_id: string | null;
          secondary_id_type: string | null;
          verified_status: string;
          role: string;
          is_lister: boolean;
          rejection_reason: string | null;
          avatar_url: string | null;
          gender: string | null;
          payout_method: string | null;
          payout_account_name: string | null;
          payout_account_number: string | null;
          emergency_contact_number: string | null;
          login_blocked_until: string | null;
          login_block_reason: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          first_name?: string | null;
          middle_name?: string | null;
          last_name?: string | null;
          phone?: string | null;
          secondary_phone?: string | null;
          address?: string | null;
          birthday?: string | null;
          driver_license?: string | null;
          national_id?: string | null;
          secondary_id_type?: string | null;
          verified_status?: string;
          role?: string;
          is_lister?: boolean;
          rejection_reason?: string | null;
          avatar_url?: string | null;
          gender?: string | null;
          payout_method?: string | null;
          payout_account_name?: string | null;
          payout_account_number?: string | null;
          emergency_contact_number?: string | null;
          login_blocked_until?: string | null;
          login_block_reason?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          first_name?: string | null;
          middle_name?: string | null;
          last_name?: string | null;
          phone?: string | null;
          secondary_phone?: string | null;
          address?: string | null;
          birthday?: string | null;
          driver_license?: string | null;
          national_id?: string | null;
          secondary_id_type?: string | null;
          verified_status?: string;
          role?: string;
          is_lister?: boolean;
          rejection_reason?: string | null;
          avatar_url?: string | null;
          gender?: string | null;
          payout_method?: string | null;
          payout_account_name?: string | null;
          payout_account_number?: string | null;
          emergency_contact_number?: string | null;
          login_blocked_until?: string | null;
          login_block_reason?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      verification_images: {
        Row: {
          id: string;
          user_id: string;
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
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          image_type: string;
          storage_path: string;
          provenance_status?: string;
          provenance_source?: string | null;
          provenance_summary?: string | null;
          ai_suspicion_score?: number | null;
          ai_detector_name?: string | null;
          ai_detector_version?: string | null;
          review_flag?: string;
          review_reason?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          image_type?: string;
          storage_path?: string;
          provenance_status?: string;
          provenance_source?: string | null;
          provenance_summary?: string | null;
          ai_suspicion_score?: number | null;
          ai_detector_name?: string | null;
          ai_detector_version?: string | null;
          review_flag?: string;
          review_reason?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "verification_images_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      car_brands: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: { id?: string; name?: string; created_at?: string };
        Relationships: [];
      };
      car_models: {
        Row: {
          id: string;
          brand_id: string;
          name: string;
          body_type: string;
          seats: number;
          fuel_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          brand_id: string;
          name: string;
          body_type: string;
          seats?: number;
          fuel_type: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          brand_id?: string;
          name?: string;
          body_type?: string;
          seats?: number;
          fuel_type?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "car_models_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "car_brands";
            referencedColumns: ["id"];
          },
        ];
      };
      cars: {
        Row: {
          id: string;
          owner_id: string;
          model_id: string;
          plate_number: string;
          mileage: number | null;
          price_per_day: number;
          security_deposit_amount: number;
          location: string | null;
          fuel_category: string | null;
          fuel_subtype: string | null;
          gps_available: boolean;
          additional_info: string | null;
          contact_number: string | null;
          status: string;
          rejection_reason: string | null;
          last_verified_at: string | null;
          registration_expiry: string | null;
          ctpl_expiry: string | null;
          comprehensive_insurance_expiry: string | null;
          insurer_rental_use_confirmed: boolean;
          insurance_verification_status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          model_id: string;
          plate_number: string;
          mileage?: number | null;
          price_per_day: number;
          security_deposit_amount?: number;
          location?: string | null;
          fuel_category?: string | null;
          fuel_subtype?: string | null;
          gps_available?: boolean;
          additional_info?: string | null;
          contact_number?: string | null;
          status?: string;
          rejection_reason?: string | null;
          last_verified_at?: string | null;
          registration_expiry?: string | null;
          ctpl_expiry?: string | null;
          comprehensive_insurance_expiry?: string | null;
          insurer_rental_use_confirmed?: boolean;
          insurance_verification_status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          model_id?: string;
          plate_number?: string;
          mileage?: number | null;
          price_per_day?: number;
          security_deposit_amount?: number;
          location?: string | null;
          fuel_category?: string | null;
          fuel_subtype?: string | null;
          gps_available?: boolean;
          additional_info?: string | null;
          contact_number?: string | null;
          status?: string;
          rejection_reason?: string | null;
          last_verified_at?: string | null;
          registration_expiry?: string | null;
          ctpl_expiry?: string | null;
          comprehensive_insurance_expiry?: string | null;
          insurer_rental_use_confirmed?: boolean;
          insurance_verification_status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cars_model_id_fkey";
            columns: ["model_id"];
            isOneToOne: false;
            referencedRelation: "car_models";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cars_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      car_renewals: {
        Row: {
          id: string;
          car_id: string;
          lister_id: string;
          orcr_document_path: string;
          lto_receipt_path: string;
          mvir_path: string;
          emission_test_path: string;
          updated_car_photos_path: string;
          current_mileage: number;
          status: string;
          admin_notes: string | null;
          submitted_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          car_id: string;
          lister_id: string;
          orcr_document_path: string;
          lto_receipt_path: string;
          mvir_path: string;
          emission_test_path: string;
          updated_car_photos_path: string;
          current_mileage: number;
          status?: string;
          admin_notes?: string | null;
          submitted_at?: string;
          reviewed_at?: string | null;
        };
        Update: {
          id?: string;
          car_id?: string;
          lister_id?: string;
          orcr_document_path?: string;
          lto_receipt_path?: string;
          mvir_path?: string;
          emission_test_path?: string;
          updated_car_photos_path?: string;
          current_mileage?: number;
          status?: string;
          admin_notes?: string | null;
          submitted_at?: string;
          reviewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "car_renewals_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "car_renewals_lister_id_fkey";
            columns: ["lister_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      car_images: {
        Row: {
          id: string;
          car_id: string;
          storage_path: string;
          is_primary: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          car_id: string;
          storage_path: string;
          is_primary?: boolean | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          car_id?: string;
          storage_path?: string;
          is_primary?: boolean | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "car_images_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      car_documents: {
        Row: {
          id: string;
          car_id: string;
          document_type: string;
          storage_path: string;
          content_sha256: string | null;
          provenance_status: string;
          provenance_source: string | null;
          provenance_summary: string | null;
          ai_suspicion_score: number | null;
          ai_detector_name: string | null;
          ai_detector_version: string | null;
          review_flag: string;
          review_reason: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          car_id: string;
          document_type: string;
          storage_path: string;
          content_sha256?: string | null;
          provenance_status?: string;
          provenance_source?: string | null;
          provenance_summary?: string | null;
          ai_suspicion_score?: number | null;
          ai_detector_name?: string | null;
          ai_detector_version?: string | null;
          review_flag?: string;
          review_reason?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          car_id?: string;
          document_type?: string;
          storage_path?: string;
          content_sha256?: string | null;
          provenance_status?: string;
          provenance_source?: string | null;
          provenance_summary?: string | null;
          ai_suspicion_score?: number | null;
          ai_detector_name?: string | null;
          ai_detector_version?: string | null;
          review_flag?: string;
          review_reason?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "car_documents_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          id: string;
          car_id: string;
          renter_id: string;
          owner_id: string;
          start_date: string;
          end_date: string;
          total_days: number;
          base_price: number;
          commission: number;
          total_price: number;
          downpayment_amount: number;
          balance_amount: number;
          status: string;
          payment_deadline: string | null;
          owner_response_deadline: string | null;
          renter_completed: boolean;
          owner_completed: boolean;
          renter_completed_at: string | null;
          owner_completed_at: string | null;
          paymongo_checkout_id: string | null;
          paymongo_balance_checkout_id: string | null;
          pickup_time: string | null;
          dropoff_time: string | null;
          lister_arrived_at: string | null;
          renter_arrived_at: string | null;
          lister_arrival_photo_url: string | null;
          renter_arrival_photo_url: string | null;
          lister_arrival_latitude: number | null;
          lister_arrival_longitude: number | null;
          lister_arrival_accuracy_meters: number | null;
          lister_arrival_location_captured_at: string | null;
          renter_arrival_latitude: number | null;
          renter_arrival_longitude: number | null;
          renter_arrival_accuracy_meters: number | null;
          renter_arrival_location_captured_at: string | null;
          agreement_version_id: string | null;
          agreement_storage_path_snapshot: string | null;
          agreement_sha256_snapshot: string | null;
          payment_processing_fee: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          car_id: string;
          renter_id: string;
          owner_id: string;
          start_date: string;
          end_date: string;
          total_days: number;
          base_price: number;
          commission: number;
          total_price: number;
          downpayment_amount: number;
          balance_amount: number;
          status?: string;
          owner_response_deadline?: string | null;
          payment_deadline?: string | null;
          paymongo_checkout_id?: string | null;
          paymongo_balance_checkout_id?: string | null;
          renter_completed?: boolean | null;
          owner_completed?: boolean | null;
          renter_completed_at?: string | null;
          owner_completed_at?: string | null;
          pickup_time?: string | null;
          dropoff_time?: string | null;
          lister_arrived_at?: string | null;
          renter_arrived_at?: string | null;
          lister_arrival_photo_url?: string | null;
          renter_arrival_photo_url?: string | null;
          lister_arrival_latitude?: number | null;
          lister_arrival_longitude?: number | null;
          lister_arrival_accuracy_meters?: number | null;
          lister_arrival_location_captured_at?: string | null;
          renter_arrival_latitude?: number | null;
          renter_arrival_longitude?: number | null;
          renter_arrival_accuracy_meters?: number | null;
          renter_arrival_location_captured_at?: string | null;
          agreement_version_id?: string | null;
          agreement_storage_path_snapshot?: string | null;
          agreement_sha256_snapshot?: string | null;
          payment_processing_fee?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          car_id?: string;
          renter_id?: string;
          owner_id?: string;
          start_date?: string;
          end_date?: string;
          total_days?: number;
          base_price?: number;
          commission?: number;
          total_price?: number;
          downpayment_amount?: number;
          balance_amount?: number;
          status?: string;
          owner_response_deadline?: string | null;
          payment_deadline?: string | null;
          paymongo_checkout_id?: string | null;
          paymongo_balance_checkout_id?: string | null;
          renter_completed?: boolean | null;
          owner_completed?: boolean | null;
          renter_completed_at?: string | null;
          owner_completed_at?: string | null;
          pickup_time?: string | null;
          dropoff_time?: string | null;
          lister_arrived_at?: string | null;
          renter_arrived_at?: string | null;
          lister_arrival_photo_url?: string | null;
          renter_arrival_photo_url?: string | null;
          lister_arrival_latitude?: number | null;
          lister_arrival_longitude?: number | null;
          lister_arrival_accuracy_meters?: number | null;
          lister_arrival_location_captured_at?: string | null;
          renter_arrival_latitude?: number | null;
          renter_arrival_longitude?: number | null;
          renter_arrival_accuracy_meters?: number | null;
          renter_arrival_location_captured_at?: string | null;
          agreement_version_id?: string | null;
          agreement_storage_path_snapshot?: string | null;
          agreement_sha256_snapshot?: string | null;
          payment_processing_fee?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_renter_id_fkey";
            columns: ["renter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          booking_id: string;
          amount: number;
          payment_type: string;
          status: string;
          transaction_id: string | null;
          payment_method: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          amount: number;
          payment_type: string;
          status?: string;
          transaction_id?: string | null;
          payment_method?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string;
          amount?: number;
          payment_type?: string;
          status?: string;
          transaction_id?: string | null;
          payment_method?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_extensions: {
        Row: {
          id: string;
          booking_id: string;
          renter_id: string;
          owner_id: string;
          current_end_date: string;
          requested_end_date: string;
          extension_days: number;
          requested_total_days: number;
          reason: string;
          fuel_top_up_amount: number;
          extension_amount: number;
          total_additional_amount: number;
          status: string;
          owner_decision_note: string | null;
          payment_deadline: string | null;
          paymongo_checkout_id: string | null;
          requested_at: string;
          approved_at: string | null;
          rejected_at: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          renter_id: string;
          owner_id: string;
          current_end_date: string;
          requested_end_date: string;
          extension_days: number;
          requested_total_days: number;
          reason: string;
          fuel_top_up_amount?: number;
          extension_amount?: number;
          total_additional_amount?: number;
          status?: string;
          owner_decision_note?: string | null;
          payment_deadline?: string | null;
          paymongo_checkout_id?: string | null;
          requested_at?: string;
          approved_at?: string | null;
          rejected_at?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string;
          renter_id?: string;
          owner_id?: string;
          current_end_date?: string;
          requested_end_date?: string;
          extension_days?: number;
          requested_total_days?: number;
          reason?: string;
          fuel_top_up_amount?: number;
          extension_amount?: number;
          total_additional_amount?: number;
          status?: string;
          owner_decision_note?: string | null;
          payment_deadline?: string | null;
          paymongo_checkout_id?: string | null;
          requested_at?: string;
          approved_at?: string | null;
          rejected_at?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_extensions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_extensions_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_extensions_renter_id_fkey";
            columns: ["renter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_reviews: {
        Row: {
          id: string;
          booking_id: string;
          car_id: string;
          reviewer_id: string;
          reviewee_id: string;
          reviewer_role: string;
          rating: number;
          feedback: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          booking_id: string;
          car_id: string;
          reviewer_id: string;
          reviewee_id: string;
          reviewer_role: string;
          rating: number;
          feedback?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          booking_id?: string;
          car_id?: string;
          reviewer_id?: string;
          reviewee_id?: string;
          reviewer_role?: string;
          rating?: number;
          feedback?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_reviews_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_reviews_car_id_fkey";
            columns: ["car_id"];
            isOneToOne: false;
            referencedRelation: "cars";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_reviews_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_reviews_reviewee_id_fkey";
            columns: ["reviewee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      guest_inquiries: {
        Row: {
          id: string;
          name: string;
          email: string;
          phone: string | null;
          subject: string;
          topics: string[];
          message: string;
          status: "open" | "in_progress" | "resolved" | "closed";
          admin_reply: string | null;
          replied_at: string | null;
          review_started_at: string | null;
          resolved_at: string | null;
          assigned_admin_id: string | null;
          request_fingerprint: string;
          source: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          phone?: string | null;
          subject: string;
          topics?: string[];
          message: string;
          status?: "open" | "in_progress" | "resolved" | "closed";
          admin_reply?: string | null;
          replied_at?: string | null;
          review_started_at?: string | null;
          resolved_at?: string | null;
          assigned_admin_id?: string | null;
          request_fingerprint: string;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          phone?: string | null;
          subject?: string;
          topics?: string[];
          message?: string;
          status?: "open" | "in_progress" | "resolved" | "closed";
          admin_reply?: string | null;
          replied_at?: string | null;
          review_started_at?: string | null;
          resolved_at?: string | null;
          assigned_admin_id?: string | null;
          request_fingerprint?: string;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guest_inquiries_assigned_admin_id_fkey";
            columns: ["assigned_admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      car_agreement_versions: {
        Row: { id: string; car_id: string; document_id: string | null; version_number: number; storage_path: string; content_sha256: string | null; status: string; uploaded_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string };
        Insert: { id?: string; car_id: string; document_id?: string | null; version_number: number; storage_path: string; content_sha256?: string | null; status?: string; uploaded_by?: string | null; approved_by?: string | null; approved_at?: string | null; created_at?: string };
        Update: { id?: string; car_id?: string; document_id?: string | null; version_number?: number; storage_path?: string; content_sha256?: string | null; status?: string; uploaded_by?: string | null; approved_by?: string | null; approved_at?: string | null; created_at?: string };
        Relationships: [];
      };
      booking_agreement_acceptances: {
        Row: { id: string; booking_id: string; agreement_version_id: string; renter_id: string; accepted_at: string; acceptance_text_version: string };
        Insert: { id?: string; booking_id: string; agreement_version_id: string; renter_id: string; accepted_at?: string; acceptance_text_version?: string };
        Update: { id?: string; booking_id?: string; agreement_version_id?: string; renter_id?: string; accepted_at?: string; acceptance_text_version?: string };
        Relationships: [];
      };
      vehicle_unavailability: {
        Row: { id: string; car_id: string; owner_id: string; start_date: string; end_date: string; reason: string; category: string; created_at: string; updated_at: string };
        Insert: { id?: string; car_id: string; owner_id: string; start_date: string; end_date: string; reason: string; category?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; car_id?: string; owner_id?: string; start_date?: string; end_date?: string; reason?: string; category?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      trip_condition_reports: {
        Row: { id: string; booking_id: string; reporter_id: string; reporter_role: string; phase: string; odometer_reading: number; fuel_or_battery_level: number; damage_notes: string; latitude: number | null; longitude: number | null; location_accuracy_meters: number | null; location_consent: boolean; submitted_at: string };
        Insert: { id?: string; booking_id: string; reporter_id: string; reporter_role: string; phase: string; odometer_reading: number; fuel_or_battery_level: number; damage_notes?: string; latitude?: number | null; longitude?: number | null; location_accuracy_meters?: number | null; location_consent?: boolean; submitted_at?: string };
        Update: { id?: string; booking_id?: string; reporter_id?: string; reporter_role?: string; phase?: string; odometer_reading?: number; fuel_or_battery_level?: number; damage_notes?: string; latitude?: number | null; longitude?: number | null; location_accuracy_meters?: number | null; location_consent?: boolean; submitted_at?: string };
        Relationships: [];
      };
      trip_condition_photos: {
        Row: { id: string; report_id: string; category: string; storage_path: string; captured_at: string };
        Insert: { id?: string; report_id: string; category: string; storage_path: string; captured_at?: string };
        Update: { id?: string; report_id?: string; category?: string; storage_path?: string; captured_at?: string };
        Relationships: [];
      };
      security_deposits: {
        Row: { id: string; booking_id: string; renter_id: string; owner_id: string; amount_centavos: number; status: string; provider_payment_id: string | null; provider_checkout_id: string | null; provider_refund_id: string | null; claim_deadline: string | null; paid_at: string | null; released_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; booking_id: string; renter_id: string; owner_id: string; amount_centavos: number; status?: string; provider_payment_id?: string | null; provider_checkout_id?: string | null; provider_refund_id?: string | null; claim_deadline?: string | null; paid_at?: string | null; released_at?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; booking_id?: string; renter_id?: string; owner_id?: string; amount_centavos?: number; status?: string; provider_payment_id?: string | null; provider_checkout_id?: string | null; provider_refund_id?: string | null; claim_deadline?: string | null; paid_at?: string | null; released_at?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      security_deposit_claims: {
        Row: { id: string; security_deposit_id: string; requested_by: string; amount_centavos: number; reason: string; evidence: Json; renter_response: string | null; status: string; approved_amount_centavos: number | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string };
        Insert: { id?: string; security_deposit_id: string; requested_by: string; amount_centavos: number; reason: string; evidence?: Json; renter_response?: string | null; status?: string; approved_amount_centavos?: number | null; reviewed_by?: string | null; reviewed_at?: string | null; created_at?: string };
        Update: { id?: string; security_deposit_id?: string; requested_by?: string; amount_centavos?: number; reason?: string; evidence?: Json; renter_response?: string | null; status?: string; approved_amount_centavos?: number | null; reviewed_by?: string | null; reviewed_at?: string | null; created_at?: string };
        Relationships: [];
      };
      data_retention_requests: {
        Row: { id: string; subject_user_id: string | null; requester_email: string; request_type: string; status: string; request_details: string; decision_reason: string | null; legal_hold_reason: string | null; assigned_to: string | null; due_at: string | null; completed_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; subject_user_id?: string | null; requester_email: string; request_type: string; status?: string; request_details: string; decision_reason?: string | null; legal_hold_reason?: string | null; assigned_to?: string | null; due_at?: string | null; completed_at?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; subject_user_id?: string | null; requester_email?: string; request_type?: string; status?: string; request_details?: string; decision_reason?: string | null; legal_hold_reason?: string | null; assigned_to?: string | null; due_at?: string | null; completed_at?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      retention_policy_rules: {
        Row: { record_category: string; retention_days: number | null; rationale: string; active: boolean; updated_at: string };
        Insert: { record_category: string; retention_days?: number | null; rationale: string; active?: boolean; updated_at?: string };
        Update: { record_category?: string; retention_days?: number | null; rationale?: string; active?: boolean; updated_at?: string };
        Relationships: [];
      };
      financial_accounts: {
        Row: { code: string; name: string; account_type: string; active: boolean };
        Insert: { code: string; name: string; account_type: string; active?: boolean };
        Update: { code?: string; name?: string; account_type?: string; active?: boolean };
        Relationships: [];
      };
      ledger_journals: {
        Row: { id: string; booking_id: string | null; event_key: string; event_type: string; provider_reference: string | null; status: string; effective_at: string; finalized_at: string | null; finalized_by: string | null; reversal_of: string | null; correction_reason: string | null; metadata: Json; created_at: string };
        Insert: { id?: string; booking_id?: string | null; event_key: string; event_type: string; provider_reference?: string | null; status?: string; effective_at?: string; finalized_at?: string | null; finalized_by?: string | null; reversal_of?: string | null; correction_reason?: string | null; metadata?: Json; created_at?: string };
        Update: { id?: string; booking_id?: string | null; event_key?: string; event_type?: string; provider_reference?: string | null; status?: string; effective_at?: string; finalized_at?: string | null; finalized_by?: string | null; reversal_of?: string | null; correction_reason?: string | null; metadata?: Json; created_at?: string };
        Relationships: [];
      };
      ledger_entries: {
        Row: { id: string; journal_id: string; account_code: string; debit_centavos: number; credit_centavos: number; party_user_id: string | null; memo: string | null; created_at: string };
        Insert: { id?: string; journal_id: string; account_code: string; debit_centavos?: number; credit_centavos?: number; party_user_id?: string | null; memo?: string | null; created_at?: string };
        Update: { id?: string; journal_id?: string; account_code?: string; debit_centavos?: number; credit_centavos?: number; party_user_id?: string | null; memo?: string | null; created_at?: string };
        Relationships: [];
      };
      reconciliation_runs: {
        Row: { id: string; period_start: string; period_end: string; status: string; started_by: string | null; started_at: string; completed_at: string | null; summary: Json };
        Insert: { id?: string; period_start: string; period_end: string; status?: string; started_by?: string | null; started_at?: string; completed_at?: string | null; summary?: Json };
        Update: { id?: string; period_start?: string; period_end?: string; status?: string; started_by?: string | null; started_at?: string; completed_at?: string | null; summary?: Json };
        Relationships: [];
      };
      reconciliation_items: {
        Row: { id: string; run_id: string | null; booking_id: string | null; issue_type: string; severity: string; provider_reference: string | null; local_reference: string | null; provider_amount_centavos: number | null; local_amount_centavos: number | null; status: string; resolution: string | null; resolved_by: string | null; resolved_at: string | null; created_at: string };
        Insert: { id?: string; run_id?: string | null; booking_id?: string | null; issue_type: string; severity?: string; provider_reference?: string | null; local_reference?: string | null; provider_amount_centavos?: number | null; local_amount_centavos?: number | null; status?: string; resolution?: string | null; resolved_by?: string | null; resolved_at?: string | null; created_at?: string };
        Update: { id?: string; run_id?: string | null; booking_id?: string | null; issue_type?: string; severity?: string; provider_reference?: string | null; local_reference?: string | null; provider_amount_centavos?: number | null; local_amount_centavos?: number | null; status?: string; resolution?: string | null; resolved_by?: string | null; resolved_at?: string | null; created_at?: string };
        Relationships: [];
      };
      security_logs: {
        Row: {
          id: string;
          user_id: string | null;
          event_type: string;
          auth_method: string | null;
          status: string;
          ip_address: string | null;
          user_agent: string | null;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          event_type: string;
          auth_method?: string | null;
          status?: string;
          ip_address?: string | null;
          user_agent?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          event_type?: string;
          auth_method?: string | null;
          status?: string;
          ip_address?: string | null;
          user_agent?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "security_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          id: string;
          commission_rate: number;
          ledger_activated_at: string | null;
          payment_processing_fee_rate: number;
          payment_processing_fixed_centavos: number;
          downpayment_rate: number;
          refund_full_hours: number;
          refund_late_renter_percent: number;
          arrival_checkin_lead_hours: number;
          deposit_claim_window_hours: number;
          lister_completion_timeout_hours: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          commission_rate?: number;
          ledger_activated_at?: string | null;
          payment_processing_fee_rate?: number;
          payment_processing_fixed_centavos?: number;
          downpayment_rate?: number;
          refund_full_hours?: number;
          refund_late_renter_percent?: number;
          arrival_checkin_lead_hours?: number;
          deposit_claim_window_hours?: number;
          lister_completion_timeout_hours?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          commission_rate?: number;
          ledger_activated_at?: string | null;
          payment_processing_fee_rate?: number;
          payment_processing_fixed_centavos?: number;
          downpayment_rate?: number;
          refund_full_hours?: number;
          refund_late_renter_percent?: number;
          arrival_checkin_lead_hours?: number;
          deposit_claim_window_hours?: number;
          lister_completion_timeout_hours?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_setting_change_requests: {
        Row: {
          id: string;
          proposed_by: string;
          changes: Json;
          snapshot: Json;
          reason: string | null;
          status: "pending" | "applied" | "rejected" | "expired" | "cancelled";
          created_at: string;
          resolved_at: string | null;
          expires_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      platform_setting_change_votes: {
        Row: {
          request_id: string;
          voter_id: string;
          vote: "approve" | "reject";
          voted_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan_type: string;
          additional_slots: number;
          start_date: string;
          end_date: string | null;
          status: string;
          provider_checkout_id: string | null;
          provider_payment_id: string | null;
          amount_centavos: number | null;
          paid_at: string | null;
          cancelled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan_type?: string;
          additional_slots?: number;
          start_date?: string;
          end_date?: string | null;
          status?: string;
          provider_checkout_id?: string | null;
          provider_payment_id?: string | null;
          amount_centavos?: number | null;
          paid_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          plan_type?: string;
          additional_slots?: number;
          start_date?: string;
          end_date?: string | null;
          status?: string;
          provider_checkout_id?: string | null;
          provider_payment_id?: string | null;
          amount_centavos?: number | null;
          paid_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          id: string;
          user_id: string;
          participant_user_id: string | null;
          subject: string;
          tag: string | null;
          booking_id: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          participant_user_id?: string | null;
          subject: string;
          tag?: string | null;
          booking_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          participant_user_id?: string | null;
          subject?: string;
          tag?: string | null;
          booking_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_tickets_participant_user_id_fkey";
            columns: ["participant_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_messages: {
        Row: {
          id: string;
          ticket_id: string;
          sender_id: string;
          message: string;
          attachment_name: string | null;
          attachment_mime_type: string | null;
          attachment_storage_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          sender_id: string;
          message: string;
          attachment_name?: string | null;
          attachment_mime_type?: string | null;
          attachment_storage_path?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          ticket_id?: string;
          sender_id?: string;
          message?: string;
          attachment_name?: string | null;
          attachment_mime_type?: string | null;
          attachment_storage_path?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          message: string;
          type: string;
          read: boolean | null;
          link: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          message: string;
          type?: string;
          read?: boolean | null;
          link?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          message?: string;
          type?: string;
          read?: boolean | null;
          link?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      expire_timed_out_bookings: { Args: never; Returns: undefined };
      finalize_ledger_journal: { Args: { p_journal_id: string; p_actor?: string }; Returns: undefined };
      create_ledger_correction: {
        Args: { p_original_journal_id: string; p_reason: string; p_corrected_entries: Json };
        Returns: Json;
      };
      submit_data_retention_request: {
        Args: { p_request_type: string; p_details: string };
        Returns: { id: string; status: string; due_at: string }[];
      };
      submit_guest_inquiry: {
        Args: {
          p_name: string;
          p_email: string;
          p_phone: string | null;
          p_topics: string[];
          p_message: string;
          p_request_fingerprint: string;
        };
        Returns: string;
      };
      get_car_blackout_ranges: {
        Args: { p_car_id: string };
        Returns: { start_date: string; end_date: string; category: string }[];
      };
      propose_platform_setting_change: {
        Args: { p_changes: Json; p_reason?: string | null };
        Returns: string;
      };
      vote_platform_setting_change: {
        Args: { p_request_id: string; p_vote: string };
        Returns: string;
      };
      cancel_platform_setting_change: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

// Convenience type aliases
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Car = Database["public"]["Tables"]["cars"]["Row"];
export type CarBrand = Database["public"]["Tables"]["car_brands"]["Row"];
export type CarModel = Database["public"]["Tables"]["car_models"]["Row"];
export type CarImage = Database["public"]["Tables"]["car_images"]["Row"];
export type CarDocument = Database["public"]["Tables"]["car_documents"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type BookingReview =
  Database["public"]["Tables"]["booking_reviews"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_log"]["Row"];
export type GuestInquiry = Database["public"]["Tables"]["guest_inquiries"]["Row"];
export type SecurityLog = Database["public"]["Tables"]["security_logs"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];
export type VerificationImage =
  Database["public"]["Tables"]["verification_images"]["Row"];
export type Notification = Database["public"]["Tables"]["notifications"]["Row"];
export type CarRenewal = Database["public"]["Tables"]["car_renewals"]["Row"];
export type PlatformSettings =
  Database["public"]["Tables"]["platform_settings"]["Row"];
export type SupportTicketRow =
  Database["public"]["Tables"]["support_tickets"]["Row"];
export type TicketMessageRow =
  Database["public"]["Tables"]["ticket_messages"]["Row"];

// Extended types with joins
export interface CarWithDetails extends Car {
  car_models: CarModel & { car_brands: CarBrand };
  car_images: CarImage[];
  car_documents?: CarDocument[];
  profiles: Pick<Profile, "full_name" | "phone" | "email">;
}

export interface BookingWithDetails extends Booking {
  cars: CarWithDetails;
  renter: Profile;
  owner: Profile;
}

export type SupportTicket = SupportTicketRow;

export type TicketMessage = TicketMessageRow;
