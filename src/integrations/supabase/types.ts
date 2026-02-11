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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      feedback_learning_index: {
        Row: {
          id: string
          learned_score: number
          query_matches: string[] | null
          snippet: string | null
          title: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          id?: string
          learned_score?: number
          query_matches?: string[] | null
          snippet?: string | null
          title?: string | null
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          id?: string
          learned_score?: number
          query_matches?: string[] | null
          snippet?: string | null
          title?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          default_aggregation_method: string
          display_name: string | null
          id: string
          reading_speed: number
          updated_at: string
          weight_b: number
          weight_c: number
          weight_e: number
          weight_p: number
          weight_s: number
          weight_t: number
          weight_v: number
        }
        Insert: {
          created_at?: string
          default_aggregation_method?: string
          display_name?: string | null
          id: string
          reading_speed?: number
          updated_at?: string
          weight_b?: number
          weight_c?: number
          weight_e?: number
          weight_p?: number
          weight_s?: number
          weight_t?: number
          weight_v?: number
        }
        Update: {
          created_at?: string
          default_aggregation_method?: string
          display_name?: string | null
          id?: string
          reading_speed?: number
          updated_at?: string
          weight_b?: number
          weight_c?: number
          weight_e?: number
          weight_p?: number
          weight_s?: number
          weight_t?: number
          weight_v?: number
        }
        Relationships: []
      }
      search_history: {
        Row: {
          created_at: string
          id: string
          query: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          query: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          query?: string
          user_id?: string
        }
        Relationships: []
      }
      search_quality_measures: {
        Row: {
          engine: string
          id: string
          query_count: number
          sqm_score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          engine: string
          id?: string
          query_count?: number
          sqm_score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          engine?: string
          id?: string
          query_count?: number
          sqm_score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      search_results: {
        Row: {
          aggregated_rank: number | null
          created_at: string
          engine: string
          id: string
          original_rank: number
          search_history_id: string
          snippet: string | null
          title: string
          url: string
        }
        Insert: {
          aggregated_rank?: number | null
          created_at?: string
          engine: string
          id?: string
          original_rank: number
          search_history_id: string
          snippet?: string | null
          title: string
          url: string
        }
        Update: {
          aggregated_rank?: number | null
          created_at?: string
          engine?: string
          id?: string
          original_rank?: number
          search_history_id?: string
          snippet?: string | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_results_search_history_id_fkey"
            columns: ["search_history_id"]
            isOneToOne: false
            referencedRelation: "search_history"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feedback: {
        Row: {
          bookmarked: boolean | null
          click_order: number | null
          copy_paste_chars: number | null
          created_at: string
          dwell_time_ms: number | null
          emailed: boolean | null
          id: string
          printed: boolean | null
          saved: boolean | null
          search_result_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bookmarked?: boolean | null
          click_order?: number | null
          copy_paste_chars?: number | null
          created_at?: string
          dwell_time_ms?: number | null
          emailed?: boolean | null
          id?: string
          printed?: boolean | null
          saved?: boolean | null
          search_result_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bookmarked?: boolean | null
          click_order?: number | null
          copy_paste_chars?: number | null
          created_at?: string
          dwell_time_ms?: number | null
          emailed?: boolean | null
          id?: string
          printed?: boolean | null
          saved?: boolean | null
          search_result_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feedback_search_result_id_fkey"
            columns: ["search_result_id"]
            isOneToOne: false
            referencedRelation: "search_results"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
