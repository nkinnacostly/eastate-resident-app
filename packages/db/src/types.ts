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
    PostgrestVersion: "14.15"
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
          estate_id: string
          expires_at: string
          id: string
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
          estate_id: string
          expires_at: string
          id?: string
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
          estate_id?: string
          expires_at?: string
          id?: string
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
      estates: {
        Row: {
          address: string | null
          contact_info: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          address?: string | null
          contact_info?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          address?: string | null
          contact_info?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string
          deactivated_at: string | null
          estate_id: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["membership_role"]
          unit: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          estate_id: string
          id?: string
          is_active?: boolean
          role: Database["public"]["Enums"]["membership_role"]
          unit?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          estate_id?: string
          id?: string
          is_active?: boolean
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
        ]
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
          phone: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
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
          client_event_id: string
          code_id: string | null
          collision: boolean
          estate_id: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds: number | null
          reject_reason: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at: string
          verified_at: string
          verified_by_membership_id: string
        }
        Insert: {
          client_event_id: string
          code_id?: string | null
          collision?: boolean
          estate_id: string
          id?: string
          outcome?: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds?: number | null
          reject_reason?: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at?: string
          verified_at: string
          verified_by_membership_id: string
        }
        Update: {
          client_event_id?: string
          code_id?: string | null
          collision?: boolean
          estate_id?: string
          id?: string
          outcome?: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds?: number | null
          reject_reason?: Database["public"]["Enums"]["reject_reason"] | null
          source?: Database["public"]["Enums"]["event_source"]
          synced_at?: string
          verified_at?: string
          verified_by_membership_id?: string
        }
        Relationships: [
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
          p_membership_id: string
          p_pool_age: number
          p_source: Database["public"]["Enums"]["event_source"]
          p_verified_at: string
        }
        Returns: {
          client_event_id: string
          code_id: string | null
          collision: boolean
          estate_id: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds: number | null
          reject_reason: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at: string
          verified_at: string
          verified_by_membership_id: string
        }
        SetofOptions: {
          from: "*"
          to: "verification_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_estate: {
        Args: { p_address?: string; p_contact_info?: string; p_name: string }
        Returns: string
      }
      current_membership: {
        Args: { p_estate_id: string; p_role: string }
        Returns: string
      }
      deactivate_membership: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      generate_code: { Args: { p_len?: number }; Returns: string }
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
          client_event_id: string
          code_id: string | null
          collision: boolean
          estate_id: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds: number | null
          reject_reason: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at: string
          verified_at: string
          verified_by_membership_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "verification_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_platform_admin: { Args: never; Returns: boolean }
      mint_access_code: {
        Args: { p_estate_id: string }
        Returns: {
          code: string
          expires_at: string
          result: string
        }[]
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
          code_id: string | null
          collision: boolean
          estate_id: string
          id: string
          outcome: Database["public"]["Enums"]["event_outcome"]
          pool_age_seconds: number | null
          reject_reason: Database["public"]["Enums"]["reject_reason"] | null
          source: Database["public"]["Enums"]["event_source"]
          synced_at: string
          verified_at: string
          verified_by_membership_id: string
        }
        SetofOptions: {
          from: "*"
          to: "verification_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      code_status: "active" | "used" | "revoked"
      event_outcome: "pending" | "admitted" | "collision" | "rejected"
      event_source: "online" | "offline_replay"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      code_status: ["active", "used", "revoked"],
      event_outcome: ["pending", "admitted", "collision", "rejected"],
      event_source: ["online", "offline_replay"],
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
