export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_codes: {
        Row: {
          code: string
          created_at: string
          delivery_note: string | null
          estate_id: string
          expires_at: string
          id: string
          is_delivery: boolean
          membership_id: string
          revoked_at: string | null
          revoked_by_membership_id: string | null
          revoked_reason: Database["public"]["Enums"]["revoked_reason"] | null
          status: Database["public"]["Enums"]["code_status"]
          swept_at: string | null
          sync_seq: number
          used_at: string | null
          verified_by_membership_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          delivery_note?: string | null
          estate_id: string
          expires_at: string
          id?: string
          is_delivery?: boolean
          membership_id: string
          revoked_at?: string | null
          revoked_by_membership_id?: string | null
          revoked_reason?: Database["public"]["Enums"]["revoked_reason"] | null
          status?: Database["public"]["Enums"]["code_status"]
          swept_at?: string | null
          sync_seq?: number
          used_at?: string | null
          verified_by_membership_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          delivery_note?: string | null
          estate_id?: string
          expires_at?: string
          id?: string
          is_delivery?: boolean
          membership_id?: string
          revoked_at?: string | null
          revoked_by_membership_id?: string | null
          revoked_reason?: Database["public"]["Enums"]["revoked_reason"] | null
          status?: Database["public"]["Enums"]["code_status"]
          swept_at?: string | null
          sync_seq?: number
          used_at?: string | null
          verified_by_membership_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_codes_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_codes_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_codes_revoked_by_membership_id_fkey"
            columns: ["revoked_by_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_codes_verified_by_membership_id_fkey"
            columns: ["verified_by_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      agencies: {
        Row: {
          created_at: string
          id: string
          name: string
          registration_body: string | null
          registration_expires_at: string | null
          registration_number: string | null
          registration_verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          registration_body?: string | null
          registration_expires_at?: string | null
          registration_number?: string | null
          registration_verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          registration_body?: string | null
          registration_expires_at?: string | null
          registration_number?: string | null
          registration_verified_at?: string | null
        }
        Relationships: []
      }
      agency_contracts: {
        Row: {
          agency_id: string
          created_at: string
          during: unknown
          ends_on: string | null
          estate_id: string
          id: string
          revoked_at: string | null
          starts_on: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          during?: unknown
          ends_on?: string | null
          estate_id: string
          id?: string
          revoked_at?: string | null
          starts_on?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          during?: unknown
          ends_on?: string | null
          estate_id?: string
          id?: string
          revoked_at?: string | null
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_contracts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_contracts_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_memberships: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["agency_role"]
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["agency_role"]
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["agency_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_memberships_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      code_mint_attempts: {
        Row: {
          hits: number
          membership_id: string
          window_start: string
        }
        Insert: {
          hits?: number
          membership_id: string
          window_start: string
        }
        Update: {
          hits?: number
          membership_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_mint_attempts_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      dues_charges: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          due_on: string
          estate_id: string
          house_id: string | null
          id: string
          membership_id: string | null
          paid_at: string | null
          pay_token: string
          period: string
          status: Database["public"]["Enums"]["dues_charge_status"]
          waive_reason: string | null
          waived_at: string | null
          waived_by_membership_id: string | null
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          due_on: string
          estate_id: string
          house_id?: string | null
          id?: string
          membership_id?: string | null
          paid_at?: string | null
          pay_token?: string
          period: string
          status?: Database["public"]["Enums"]["dues_charge_status"]
          waive_reason?: string | null
          waived_at?: string | null
          waived_by_membership_id?: string | null
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          due_on?: string
          estate_id?: string
          house_id?: string | null
          id?: string
          membership_id?: string | null
          paid_at?: string | null
          pay_token?: string
          period?: string
          status?: Database["public"]["Enums"]["dues_charge_status"]
          waive_reason?: string | null
          waived_at?: string | null
          waived_by_membership_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dues_charges_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dues_charges_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dues_charges_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dues_charges_waived_by_membership_id_fkey"
            columns: ["waived_by_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      dues_payments: {
        Row: {
          amount_minor: number
          charge_id: string
          created_at: string
          currency: string
          id: string
          initiated_by_membership_id: string | null
          payer_email: string | null
          provider: string
          provider_tx_id: string | null
          raw_payload: Json | null
          settled_at: string | null
          status: Database["public"]["Enums"]["dues_payment_status"]
          tx_ref: string
        }
        Insert: {
          amount_minor: number
          charge_id: string
          created_at?: string
          currency: string
          id?: string
          initiated_by_membership_id?: string | null
          payer_email?: string | null
          provider?: string
          provider_tx_id?: string | null
          raw_payload?: Json | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["dues_payment_status"]
          tx_ref: string
        }
        Update: {
          amount_minor?: number
          charge_id?: string
          created_at?: string
          currency?: string
          id?: string
          initiated_by_membership_id?: string | null
          payer_email?: string | null
          provider?: string
          provider_tx_id?: string | null
          raw_payload?: Json | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["dues_payment_status"]
          tx_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "dues_payments_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "dues_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dues_payments_initiated_by_membership_id_fkey"
            columns: ["initiated_by_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      estates: {
        Row: {
          address: string | null
          contact_info: string | null
          created_at: string
          dues_amount_minor: number | null
          dues_billing_mode: Database["public"]["Enums"]["dues_billing_mode"]
          dues_currency: string | null
          dues_enforcement_authorised_at: string | null
          dues_enforcement_authorised_by: string | null
          dues_enforcement_basis: string | null
          dues_grace_days: number
          event_retention_days: number
          id: string
          is_active: boolean
          join_code: string
          name: string
        }
        Insert: {
          address?: string | null
          contact_info?: string | null
          created_at?: string
          dues_amount_minor?: number | null
          dues_billing_mode?: Database["public"]["Enums"]["dues_billing_mode"]
          dues_currency?: string | null
          dues_enforcement_authorised_at?: string | null
          dues_enforcement_authorised_by?: string | null
          dues_enforcement_basis?: string | null
          dues_grace_days?: number
          event_retention_days?: number
          id?: string
          is_active?: boolean
          join_code?: string
          name: string
        }
        Update: {
          address?: string | null
          contact_info?: string | null
          created_at?: string
          dues_amount_minor?: number | null
          dues_billing_mode?: Database["public"]["Enums"]["dues_billing_mode"]
          dues_currency?: string | null
          dues_enforcement_authorised_at?: string | null
          dues_enforcement_authorised_by?: string | null
          dues_enforcement_basis?: string | null
          dues_grace_days?: number
          event_retention_days?: number
          id?: string
          is_active?: boolean
          join_code?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "estates_dues_enforcement_authorised_by_fkey"
            columns: ["dues_enforcement_authorised_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      guard_shifts: {
        Row: {
          agency_id: string | null
          de_identified_at: string | null
          ended_at: string | null
          ended_by_handover: boolean
          estate_id: string
          id: string
          membership_id: string | null
          started_at: string
        }
        Insert: {
          agency_id?: string | null
          de_identified_at?: string | null
          ended_at?: string | null
          ended_by_handover?: boolean
          estate_id: string
          id?: string
          membership_id?: string | null
          started_at?: string
        }
        Update: {
          agency_id?: string | null
          de_identified_at?: string | null
          ended_at?: string | null
          ended_by_handover?: boolean
          estate_id?: string
          id?: string
          membership_id?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guard_shifts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guard_shifts_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guard_shifts_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      houses: {
        Row: {
          created_at: string
          deactivated_at: string | null
          estate_id: string
          house_code: string
          house_number: string
          id: string
          is_active: boolean
          landlord_email: string | null
          landlord_name: string | null
          landlord_phone: string | null
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          estate_id: string
          house_code?: string
          house_number: string
          id?: string
          is_active?: boolean
          landlord_email?: string | null
          landlord_name?: string | null
          landlord_phone?: string | null
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          estate_id?: string
          house_code?: string
          house_number?: string
          id?: string
          is_active?: boolean
          landlord_email?: string | null
          landlord_name?: string | null
          landlord_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "houses_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
        ]
      }
      join_attempts: {
        Row: {
          hits: number
          user_id: string
          window_start: string
        }
        Insert: {
          hits?: number
          user_id: string
          window_start: string
        }
        Update: {
          hits?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      join_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by_membership_id: string | null
          decline_reason: string | null
          estate_id: string
          house_id: string | null
          id: string
          requested_unit: string | null
          status: Database["public"]["Enums"]["join_request_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by_membership_id?: string | null
          decline_reason?: string | null
          estate_id: string
          house_id?: string | null
          id?: string
          requested_unit?: string | null
          status?: Database["public"]["Enums"]["join_request_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by_membership_id?: string | null
          decline_reason?: string | null
          estate_id?: string
          house_id?: string | null
          id?: string
          requested_unit?: string | null
          status?: Database["public"]["Enums"]["join_request_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "join_requests_decided_by_membership_id_fkey"
            columns: ["decided_by_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_requests_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          deactivated_at: string | null
          estate_id: string
          house_id: string | null
          id: string
          is_active: boolean
          placed_by_agency_id: string | null
          role: Database["public"]["Enums"]["membership_role"]
          unit: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          estate_id: string
          house_id?: string | null
          id?: string
          is_active?: boolean
          placed_by_agency_id?: string | null
          role: Database["public"]["Enums"]["membership_role"]
          unit?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          estate_id?: string
          house_id?: string | null
          id?: string
          is_active?: boolean
          placed_by_agency_id?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          unit?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_placed_by_agency_id_fkey"
            columns: ["placed_by_agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_attempts: {
        Row: {
          email_key: string
          id: number
          requested_at: string
        }
        Insert: {
          email_key: string
          id?: number
          requested_at?: string
        }
        Update: {
          email_key?: string
          id?: number
          requested_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          must_change_password: boolean
          phone: string | null
          psira_expires_at: string | null
          psira_grade: string | null
          psira_registration_number: string | null
          psira_verified_at: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          must_change_password?: boolean
          phone?: string | null
          psira_expires_at?: string | null
          psira_grade?: string | null
          psira_registration_number?: string | null
          psira_verified_at?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          must_change_password?: boolean
          phone?: string | null
          psira_expires_at?: string | null
          psira_grade?: string | null
          psira_registration_number?: string | null
          psira_verified_at?: string | null
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          device_id: string | null
          expo_push_token: string
          id: string
          last_seen_at: string
          membership_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          expo_push_token: string
          id?: string
          last_seen_at?: string
          membership_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          expo_push_token?: string
          id?: string
          last_seen_at?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_events: {
        Row: {
          admitted_without_match: boolean
          agency_id: string | null
          client_event_id: string
          code_attempted: string | null
          code_id: string | null
          collision: boolean
          de_identified_at: string | null
          estate_id: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds: number | null
          reject_reason: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at: string
          verified_at: string
          verified_by_membership_id: string | null
        }
        Insert: {
          admitted_without_match?: boolean
          agency_id?: string | null
          client_event_id: string
          code_attempted?: string | null
          code_id?: string | null
          collision?: boolean
          de_identified_at?: string | null
          estate_id: string
          id?: string
          outcome?: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds?: number | null
          reject_reason?: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at?: string
          verified_at: string
          verified_by_membership_id?: string | null
        }
        Update: {
          admitted_without_match?: boolean
          agency_id?: string | null
          client_event_id?: string
          code_attempted?: string | null
          code_id?: string | null
          collision?: boolean
          de_identified_at?: string | null
          estate_id?: string
          id?: string
          outcome?: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds?: number | null
          reject_reason?: Database["public"]["Enums"]["reject_reason"] | null
          source?: Database["public"]["Enums"]["event_source"]
          synced_at?: string
          verified_at?: string
          verified_by_membership_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_events_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_events_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "access_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_events_estate_id_fkey"
            columns: ["estate_id"]
            isOneToOne: false
            referencedRelation: "estates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_events_verified_by_membership_id_fkey"
            columns: ["verified_by_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _ingest_verification_event: {
        Args: {
          p_client_event_id: string
          p_code: string
          p_code_id: string
          p_estate_id: string
          p_flagged?: boolean
          p_membership_id: string
          p_pool_age: number
          p_source: Database["public"]["Enums"]["event_source"]
          p_verified_at: string
        }
        Returns: {
          admitted_without_match: boolean
          agency_id: string | null
          client_event_id: string
          code_attempted: string | null
          code_id: string | null
          collision: boolean
          de_identified_at: string | null
          estate_id: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds: number | null
          reject_reason: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at: string
          verified_at: string
          verified_by_membership_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "verification_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_agency_officer: {
        Args: {
          p_agency_id: string
          p_role?: Database["public"]["Enums"]["agency_role"]
          p_user_id: string
        }
        Returns: string
      }
      agency_coverage_summary: {
        Args: { p_agency_id: string; p_from?: string; p_to?: string }
        Returns: {
          contract_live: boolean
          entries_admitted: number
          entries_flagged: number
          entries_refused: number
          estate_id: string
          estate_name: string
          hours: number
          officers: number
          shifts: number
        }[]
      }
      agency_deactivate_officer: {
        Args: { p_agency_membership_id: string }
        Returns: number
      }
      agency_monthly_return: {
        Args: { p_agency_id: string; p_month: string }
        Returns: {
          contact_phone: string
          estate_address: string
          estate_name: string
          first_shift_at: string
          grade: string
          hours: number
          last_shift_at: string
          officer_name: string
          registration_checked_at: string
          registration_expires_at: string
          registration_number: string
          shifts: number
        }[]
      }
      agency_roster: {
        Args: { p_agency_id: string }
        Returns: {
          agency_membership_id: string
          estates_posted: number
          full_name: string
          grade: string
          is_active: boolean
          registration_checked_at: string
          registration_expires_at: string
          registration_number: string
          role: Database["public"]["Enums"]["agency_role"]
        }[]
      }
      apply_retention: {
        Args: never
        Returns: {
          codes_deleted: number
          events_cleared: number
          shifts_cleared: number
        }[]
      }
      approve_join_request: { Args: { p_request_id: string }; Returns: string }
      approve_join_requests_bulk: {
        Args: { p_request_ids: string[] }
        Returns: {
          detail: string
          request_id: string
          status: string
        }[]
      }
      claim_password_reset: { Args: { p_email: string }; Returns: string }
      clear_must_change_password: { Args: never; Returns: undefined }
      create_agency: {
        Args: {
          p_admin_user_id?: string
          p_name: string
          p_registration_body?: string
          p_registration_number?: string
        }
        Returns: string
      }
      create_agency_contract: {
        Args: {
          p_agency_id: string
          p_ends_on?: string
          p_estate_id: string
          p_starts_on?: string
        }
        Returns: string
      }
      create_estate: {
        Args: { p_address?: string; p_contact_info?: string; p_name: string }
        Returns: string
      }
      create_house: {
        Args: {
          p_estate_id: string
          p_house_number: string
          p_landlord_email?: string
          p_landlord_name?: string
          p_landlord_phone?: string
        }
        Returns: {
          house_code: string
          house_number: string
          id: string
        }[]
      }
      create_houses_bulk: {
        Args: { p_estate_id: string; p_houses: Json }
        Returns: {
          house_code: string
          house_number: string
          seq: number
          status: string
        }[]
      }
      current_membership: {
        Args: { p_estate_id: string; p_role: string }
        Returns: string
      }
      current_shift: {
        Args: { p_estate_id: string }
        Returns: {
          guard_name: string
          shift_id: string
          started_at: string
        }[]
      }
      deactivate_membership: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      decline_join_request: {
        Args: { p_reason?: string; p_request_id: string }
        Returns: undefined
      }
      delete_my_account: {
        Args: never
        Returns: {
          detail: string
          status: string
        }[]
      }
      dispatch_emails_tick: { Args: never; Returns: undefined }
      dispatch_notifications_tick: { Args: never; Returns: undefined }
      dues_in_arrears: { Args: { p_membership_id: string }; Returns: boolean }
      dues_payments_awaiting_verification: {
        Args: { p_older_than?: string }
        Returns: {
          created_at: string
          provider_tx_id: string
          tx_ref: string
        }[]
      }
      dues_reconcile_tick: { Args: never; Returns: undefined }
      emails_archive: { Args: { p_msg_id: number }; Returns: boolean }
      emails_read: {
        Args: { p_qty: number; p_vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      end_agency_contract: {
        Args: { p_contract_id: string; p_revoked?: boolean }
        Returns: undefined
      }
      end_shift: {
        Args: { p_estate_id: string }
        Returns: {
          ended_at: string
          result: string
          shift_id: string
        }[]
      }
      enqueue_email: {
        Args: { p_kind: string; p_payload: Json }
        Returns: number
      }
      generate_code: { Args: { p_len?: number }; Returns: string }
      generate_dues_charges: { Args: { p_period?: string }; Returns: number }
      grant_membership: {
        Args: {
          p_estate_id: string
          p_role: string
          p_unit?: string
          p_user_id: string
        }
        Returns: string
      }
      has_membership: {
        Args: { p_estate_id: string; p_role?: string }
        Returns: boolean
      }
      ingest_verification_events: {
        Args: { p_estate_id: string; p_events: Json }
        Returns: {
          admitted_without_match: boolean
          agency_id: string | null
          client_event_id: string
          code_attempted: string | null
          code_id: string | null
          collision: boolean
          de_identified_at: string | null
          estate_id: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds: number | null
          reject_reason: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at: string
          verified_at: string
          verified_by_membership_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "verification_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_agency_admin: { Args: { p_agency_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      mint_access_code: {
        Args: {
          p_delivery_note?: string
          p_estate_id: string
          p_is_delivery?: boolean
        }
        Returns: {
          code: string
          expires_at: string
          result: string
        }[]
      }
      my_agencies: {
        Args: never
        Returns: {
          agency_id: string
          name: string
          registration_body: string
          registration_checked_at: string
          registration_expires_at: string
          registration_number: string
          role: Database["public"]["Enums"]["agency_role"]
        }[]
      }
      my_dues: {
        Args: { p_estate_id: string }
        Returns: {
          amount_minor: number
          billing_mode: Database["public"]["Enums"]["dues_billing_mode"]
          charge_id: string
          currency: string
          due_on: string
          is_overdue: boolean
          landlord_email: string
          landlord_name: string
          landlord_phone: string
          pay_token: string
          period: string
          status: Database["public"]["Enums"]["dues_charge_status"]
          subject: string
        }[]
      }
      my_pending_join_requests: {
        Args: never
        Returns: {
          created_at: string
          estate_id: string
          estate_name: string
          house_number: string
        }[]
      }
      notifications_archive: { Args: { p_msg_id: number }; Returns: boolean }
      notifications_read: {
        Args: { p_qty: number; p_vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      operator_admins: {
        Args: never
        Returns: {
          email: string
          estate_id: string
          estate_name: string
          full_name: string
          granted_at: string
          is_active: boolean
          last_sign_in_at: string
          user_id: string
        }[]
      }
      operator_daily_volume: {
        Args: { p_days?: number }
        Returns: {
          admitted: number
          day: string
          offline: number
          verifications: number
        }[]
      }
      operator_estates: {
        Args: never
        Returns: {
          address: string
          admin_count: number
          admin_email: string
          admin_name: string
          created_at: string
          flagged_30d: number
          guards: number
          houses: number
          id: string
          is_active: boolean
          join_code: string
          last_activity: string
          name: string
          residents: number
          verifications_30d: number
        }[]
      }
      operator_find_user_by_email: {
        Args: { p_email: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      operator_health: {
        Args: never
        Returns: {
          estate_id: string
          estate_name: string
          flagged_30d: number
          median_lag_seconds: number
          offline_30d: number
          offline_share: number
          stale_pool_worst_age: number
          verifications_30d: number
          worst_lag_seconds: number
        }[]
      }
      operator_platform_team: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      operator_portfolio: {
        Args: never
        Returns: {
          admins_total: number
          admitted_30d: number
          estates_live: number
          estates_onboarding: number
          estates_total: number
          flagged_30d: number
          guards_total: number
          houses_total: number
          offline_30d: number
          rejected_30d: number
          residents_total: number
          verifications_30d: number
        }[]
      }
      place_officer_at_estate: {
        Args: { p_agency_membership_id: string; p_estate_id: string }
        Returns: string
      }
      purge_password_reset_attempts: { Args: never; Returns: undefined }
      raise_current_dues: { Args: { p_estate_id: string }; Returns: number }
      record_psira_registration: {
        Args: {
          p_expires_at?: string
          p_grade?: string
          p_registration_number: string
          p_user_id: string
        }
        Returns: undefined
      }
      register_push_token: {
        Args: {
          p_device_id?: string
          p_estate_id: string
          p_role: string
          p_token: string
        }
        Returns: undefined
      }
      request_house_access: {
        Args: { p_estate_code: string; p_house_code: string }
        Returns: {
          estate_id: string
          estate_name: string
          house_id: string
          house_number: string
          result: string
        }[]
      }
      revoke_access_code: {
        Args: { p_code_id: string; p_reason?: string }
        Returns: {
          result: string
        }[]
      }
      rotate_estate_join_code: {
        Args: { p_estate_id: string }
        Returns: string
      }
      rotate_house_code: { Args: { p_house_id: string }; Returns: string }
      service_find_user_by_email: {
        Args: { p_email: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      set_dues_config: {
        Args: {
          p_amount_minor?: number
          p_billing_mode: Database["public"]["Enums"]["dues_billing_mode"]
          p_currency?: string
          p_estate_id: string
          p_grace_days?: number
        }
        Returns: undefined
      }
      set_dues_enforcement: {
        Args: { p_authorised: boolean; p_basis?: string; p_estate_id: string }
        Returns: undefined
      }
      settle_dues_payment: {
        Args: {
          p_amount_minor: number
          p_currency: string
          p_provider_status: string
          p_provider_tx_id: string
          p_raw: Json
          p_tx_ref: string
        }
        Returns: string
      }
      start_dues_payment: {
        Args: { p_charge_id: string }
        Returns: {
          amount_minor: number
          currency: string
          ok: boolean
          reason: string
          tx_ref: string
        }[]
      }
      start_dues_payment_by_token: {
        Args: { p_pay_token: string; p_payer_email: string }
        Returns: {
          amount_minor: number
          currency: string
          estate_name: string
          house_number: string
          ok: boolean
          reason: string
          tx_ref: string
        }[]
      }
      start_shift: {
        Args: { p_estate_id: string }
        Returns: {
          result: string
          shift_id: string
          started_at: string
        }[]
      }
      sweep_expired_codes: { Args: never; Returns: number }
      sweep_mint_attempts: { Args: never; Returns: number }
      sync_pull: {
        Args: { p_cursor?: number; p_estate_id: string }
        Returns: Json
      }
      verify_access_code: {
        Args: { p_client_event_id: string; p_code: string; p_estate_id: string }
        Returns: {
          client_event_id: string
          code_id: string
          collision: boolean
          host_name: string
          host_unit: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          reject_reason: Database["public"]["Enums"]["reject_reason"]
          verified_at: string
        }[]
      }
      waive_dues_charge: {
        Args: { p_charge_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      agency_role: "officer" | "admin"
      code_status: "active" | "used" | "revoked"
      dues_billing_mode: "none" | "per_house" | "per_resident"
      dues_charge_status: "open" | "paid" | "waived"
      dues_payment_status: "initiated" | "successful" | "failed" | "abandoned"
      event_outcome: "pending" | "admitted" | "collision" | "rejected"
      event_source: "online" | "offline_replay"
      join_request_status: "pending" | "approved" | "declined"
      membership_role: "resident" | "guard" | "admin"
      reject_reason: "unknown_code" | "expired" | "already_used" | "revoked"
      revoked_reason:
        | "membership_deactivated"
        | "admin_revoked"
        | "resident_cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agency_role: ["officer", "admin"],
      code_status: ["active", "used", "revoked"],
      dues_billing_mode: ["none", "per_house", "per_resident"],
      dues_charge_status: ["open", "paid", "waived"],
      dues_payment_status: ["initiated", "successful", "failed", "abandoned"],
      event_outcome: ["pending", "admitted", "collision", "rejected"],
      event_source: ["online", "offline_replay"],
      join_request_status: ["pending", "approved", "declined"],
      membership_role: ["resident", "guard", "admin"],
      reject_reason: ["unknown_code", "expired", "already_used", "revoked"],
      revoked_reason: [
        "membership_deactivated",
        "admin_revoked",
        "resident_cancelled",
      ],
    },
  },
} as const
