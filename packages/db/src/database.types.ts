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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_versions: {
        Row: {
          agent_id: string
          compiled: Json | null
          content_hash: string | null
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          published_at: string | null
          published_by: string | null
          settings: Json
          status: Database["public"]["Enums"]["agent_version_status"]
          template_id: string
          template_version: number
          test_run_id: string | null
          version_no: number
        }
        Insert: {
          agent_id: string
          compiled?: Json | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          settings: Json
          status?: Database["public"]["Enums"]["agent_version_status"]
          template_id: string
          template_version: number
          test_run_id?: string | null
          version_no: number
        }
        Update: {
          agent_id?: string
          compiled?: Json | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          settings?: Json
          status?: Database["public"]["Enums"]["agent_version_status"]
          template_id?: string
          template_version?: number
          test_run_id?: string | null
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_versions_organization_id_agent_id_fkey"
            columns: ["organization_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "agent_versions_template_id_template_version_fkey"
            columns: ["template_id", "template_version"]
            isOneToOne: false
            referencedRelation: "industry_templates"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      agents: {
        Row: {
          active_version_id: string | null
          created_at: string
          external_agent_id: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
          voice_provider: string
        }
        Insert: {
          active_version_id?: string | null
          created_at?: string
          external_agent_id?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          voice_provider?: string
        }
        Update: {
          active_version_id?: string | null
          created_at?: string
          external_agent_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          voice_provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_organization_id_active_version_id_fkey"
            columns: ["organization_id", "active_version_id"]
            isOneToOne: false
            referencedRelation: "agent_versions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_events: {
        Row: {
          actor_user_id: string | null
          appointment_id: string
          at: string
          details: Json
          from_status: Database["public"]["Enums"]["booking_status"] | null
          id: number
          organization_id: string
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Insert: {
          actor_user_id?: string | null
          appointment_id: string
          at?: string
          details?: Json
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: never
          organization_id: string
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Update: {
          actor_user_id?: string | null
          appointment_id?: string
          at?: string
          details?: Json
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: never
          organization_id?: string
          to_status?: Database["public"]["Enums"]["booking_status"]
        }
        Relationships: [
          {
            foreignKeyName: "appointment_events_organization_id_appointment_id_fkey"
            columns: ["organization_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      appointments: {
        Row: {
          block_end: string
          block_start: string
          call_id: string | null
          cancellation_reason: string | null
          created_at: string
          customer_id: string | null
          ends_at: string
          external_calendar_event_id: string | null
          hold_expires_at: string | null
          id: string
          idempotency_key: string
          location_id: string | null
          notes: string | null
          organization_id: string
          reference_hash: string | null
          rescheduled_from_id: string | null
          service_id: string
          source: string
          staff_id: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          block_end: string
          block_start: string
          call_id?: string | null
          cancellation_reason?: string | null
          created_at?: string
          customer_id?: string | null
          ends_at: string
          external_calendar_event_id?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key: string
          location_id?: string | null
          notes?: string | null
          organization_id: string
          reference_hash?: string | null
          rescheduled_from_id?: string | null
          service_id: string
          source: string
          staff_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          block_end?: string
          block_start?: string
          call_id?: string | null
          cancellation_reason?: string | null
          created_at?: string
          customer_id?: string | null
          ends_at?: string
          external_calendar_event_id?: string | null
          hold_expires_at?: string | null
          id?: string
          idempotency_key?: string
          location_id?: string | null
          notes?: string | null
          organization_id?: string
          reference_hash?: string | null
          rescheduled_from_id?: string | null
          service_id?: string
          source?: string
          staff_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_organization_id_call_id_fkey"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_organization_id_service_id_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_organization_id_staff_id_fkey"
            columns: ["organization_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "appointments_rescheduled_from_id_fkey"
            columns: ["rescheduled_from_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          organization_id: string | null
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_type: string
          actor_user_id?: string | null
          at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_rules: {
        Row: {
          allow_phone_cancellation: boolean
          allow_phone_rescheduling: boolean
          cancellation_notice_hours: number
          hold_ttl_sec: number
          max_days_ahead: number
          min_lead_min: number
          organization_id: string
          slot_interval_min: number
          updated_at: string
          walk_in_policy: Json
        }
        Insert: {
          allow_phone_cancellation?: boolean
          allow_phone_rescheduling?: boolean
          cancellation_notice_hours?: number
          hold_ttl_sec?: number
          max_days_ahead?: number
          min_lead_min?: number
          organization_id: string
          slot_interval_min?: number
          updated_at?: string
          walk_in_policy?: Json
        }
        Update: {
          allow_phone_cancellation?: boolean
          allow_phone_rescheduling?: boolean
          cancellation_notice_hours?: number
          hold_ttl_sec?: number
          max_days_ahead?: number
          min_lead_min?: number
          organization_id?: string
          slot_interval_min?: number
          updated_at?: string
          walk_in_policy?: Json
        }
        Relationships: [
          {
            foreignKeyName: "booking_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          closes: string
          id: string
          location_id: string
          opens: string
          organization_id: string
          weekday: number
        }
        Insert: {
          closes: string
          id?: string
          location_id: string
          opens: string
          organization_id: string
          weekday: number
        }
        Update: {
          closes?: string
          id?: string
          location_id?: string
          opens?: string
          organization_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      call_events: {
        Row: {
          at: string
          call_id: string
          id: number
          organization_id: string
          payload: Json
          type: string
        }
        Insert: {
          at?: string
          call_id: string
          id?: never
          organization_id: string
          payload?: Json
          type: string
        }
        Update: {
          at?: string
          call_id?: string
          id?: never
          organization_id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_events_organization_id_call_id_fkey"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      call_recordings: {
        Row: {
          call_id: string
          created_at: string
          duration_sec: number | null
          organization_id: string
          retain_until: string
          storage_path: string
        }
        Insert: {
          call_id: string
          created_at?: string
          duration_sec?: number | null
          organization_id: string
          retain_until: string
          storage_path: string
        }
        Update: {
          call_id?: string
          created_at?: string
          duration_sec?: number | null
          organization_id?: string
          retain_until?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_recordings_organization_id_call_id_fkey"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      call_transcripts: {
        Row: {
          call_id: string
          created_at: string
          organization_id: string
          redacted: boolean
          retain_until: string
          segments: Json
        }
        Insert: {
          call_id: string
          created_at?: string
          organization_id: string
          redacted?: boolean
          retain_until: string
          segments: Json
        }
        Update: {
          call_id?: string
          created_at?: string
          organization_id?: string
          redacted?: boolean
          retain_until?: string
          segments?: Json
        }
        Relationships: [
          {
            foreignKeyName: "call_transcripts_organization_id_call_id_fkey"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      calls: {
        Row: {
          agent_version_id: string | null
          cost_micros: number
          created_at: string
          customer_id: string | null
          direction: string
          duration_sec: number | null
          ended_at: string | null
          ended_by: string | null
          escalation_rule_id: string | null
          from_e164: string | null
          id: string
          language: Database["public"]["Enums"]["language_code"] | null
          organization_id: string
          outcome: string | null
          phone_number_id: string | null
          provider: string
          provider_call_id: string
          started_at: string
          summary: string | null
          to_e164: string | null
        }
        Insert: {
          agent_version_id?: string | null
          cost_micros?: number
          created_at?: string
          customer_id?: string | null
          direction?: string
          duration_sec?: number | null
          ended_at?: string | null
          ended_by?: string | null
          escalation_rule_id?: string | null
          from_e164?: string | null
          id?: string
          language?: Database["public"]["Enums"]["language_code"] | null
          organization_id: string
          outcome?: string | null
          phone_number_id?: string | null
          provider: string
          provider_call_id: string
          started_at: string
          summary?: string | null
          to_e164?: string | null
        }
        Update: {
          agent_version_id?: string | null
          cost_micros?: number
          created_at?: string
          customer_id?: string | null
          direction?: string
          duration_sec?: number | null
          ended_at?: string | null
          ended_by?: string | null
          escalation_rule_id?: string | null
          from_e164?: string | null
          id?: string
          language?: Database["public"]["Enums"]["language_code"] | null
          organization_id?: string
          outcome?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_call_id?: string
          started_at?: string
          summary?: string | null
          to_e164?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_organization_id_agent_version_id_fkey"
            columns: ["organization_id", "agent_version_id"]
            isOneToOne: false
            referencedRelation: "agent_versions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "calls_organization_id_customer_id_fkey"
            columns: ["organization_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_organization_id_phone_number_id_fkey"
            columns: ["organization_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          last_contact_at: string | null
          notes: string | null
          organization_id: string
          phone_e164: string | null
          preferred_language:
            | Database["public"]["Enums"]["language_code"]
            | null
          sms_opt_in: boolean
          sms_opt_in_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          organization_id: string
          phone_e164?: string | null
          preferred_language?:
            | Database["public"]["Enums"]["language_code"]
            | null
          sms_opt_in?: boolean
          sms_opt_in_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          organization_id?: string
          phone_e164?: string | null
          preferred_language?:
            | Database["public"]["Enums"]["language_code"]
            | null
          sms_opt_in?: boolean
          sms_opt_in_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      date_exceptions: {
        Row: {
          closed: boolean
          date: string
          id: string
          label: string | null
          location_id: string | null
          organization_id: string
          ranges: Json
          staff_id: string | null
        }
        Insert: {
          closed: boolean
          date: string
          id?: string
          label?: string | null
          location_id?: string | null
          organization_id: string
          ranges?: Json
          staff_id?: string | null
        }
        Update: {
          closed?: boolean
          date?: string
          id?: string
          label?: string | null
          location_id?: string | null
          organization_id?: string
          ranges?: Json
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "date_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_exceptions_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "date_exceptions_organization_id_staff_id_fkey"
            columns: ["organization_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      enquiries: {
        Row: {
          assigned_to: string | null
          call_id: string | null
          callback_phone_e164: string | null
          caller_name: string | null
          created_at: string
          escalation_rule_id: string | null
          fields: Json
          id: string
          kind: string
          organization_id: string
          resolved_at: string | null
          sensitive_fields: Json
          status: string
          summary: string | null
          updated_at: string
          urgency: string
        }
        Insert: {
          assigned_to?: string | null
          call_id?: string | null
          callback_phone_e164?: string | null
          caller_name?: string | null
          created_at?: string
          escalation_rule_id?: string | null
          fields?: Json
          id?: string
          kind: string
          organization_id: string
          resolved_at?: string | null
          sensitive_fields?: Json
          status?: string
          summary?: string | null
          updated_at?: string
          urgency?: string
        }
        Update: {
          assigned_to?: string | null
          call_id?: string | null
          callback_phone_e164?: string | null
          caller_name?: string | null
          created_at?: string
          escalation_rule_id?: string | null
          fields?: Json
          id?: string
          kind?: string
          organization_id?: string
          resolved_at?: string | null
          sensitive_fields?: Json
          status?: string
          summary?: string | null
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_organization_id_call_id_fkey"
            columns: ["organization_id", "call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "enquiries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          component: string | null
          details: Json
          id: string
          opened_at: string
          organization_id: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
        }
        Insert: {
          component?: string | null
          details?: Json
          id?: string
          opened_at?: string
          organization_id?: string | null
          resolved_at?: string | null
          severity: string
          status?: string
          title: string
        }
        Update: {
          component?: string | null
          details?: Json
          id?: string
          opened_at?: string
          organization_id?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_templates: {
        Row: {
          created_at: string
          definition: Json
          id: string
          is_current: boolean
          version: number
        }
        Insert: {
          created_at?: string
          definition: Json
          id: string
          is_current?: boolean
          version: number
        }
        Update: {
          created_at?: string
          definition?: Json
          id?: string
          is_current?: boolean
          version?: number
        }
        Relationships: []
      }
      integration_connections: {
        Row: {
          account_label: string | null
          created_at: string
          id: string
          last_error: string | null
          last_sync_at: string | null
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          scopes: string[]
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
        }
        Insert: {
          account_label?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          scopes?: string[]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Update: {
          account_label?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          organization_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          scopes?: string[]
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          connection_id: string
          rotated_at: string
          vault_secret_id: string
        }
        Insert: {
          connection_id: string
          rotated_at?: string
          vault_secret_id: string
        }
        Update: {
          connection_id?: string
          rotated_at?: string
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_due_minor: number
          amount_paid_minor: number
          created_at: string
          currency: string
          hosted_invoice_url: string | null
          id: string
          invoice_pdf_url: string | null
          number: string | null
          organization_id: string
          period_end: string | null
          period_start: string | null
          status: string
          stripe_invoice_id: string
        }
        Insert: {
          amount_due_minor: number
          amount_paid_minor?: number
          created_at?: string
          currency: string
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf_url?: string | null
          number?: string | null
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          status: string
          stripe_invoice_id: string
        }
        Update: {
          amount_due_minor?: number
          amount_paid_minor?: number
          created_at?: string
          currency?: string
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf_url?: string | null
          number?: string | null
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: number
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          organization_id: string | null
          payload: Json
          queue: string
          run_at: string
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: never
          kind: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organization_id?: string | null
          payload?: Json
          queue?: string
          run_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: never
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organization_id?: string | null
          payload?: Json
          queue?: string
          run_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_items: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          content: string
          created_at: string
          id: string
          kind: string
          language: Database["public"]["Enums"]["language_code"]
          organization_id: string
          question: string | null
          source: string
          source_url: string | null
          status: Database["public"]["Enums"]["knowledge_status"]
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          content: string
          created_at?: string
          id?: string
          kind: string
          language: Database["public"]["Enums"]["language_code"]
          organization_id: string
          question?: string | null
          source?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["knowledge_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          content?: string
          created_at?: string
          id?: string
          kind?: string
          language?: Database["public"]["Enums"]["language_code"]
          organization_id?: string
          question?: string | null
          source?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["knowledge_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address_line: string | null
          city: string | null
          created_at: string
          directions: Json
          id: string
          is_primary: boolean
          name: string
          organization_id: string
          postcode: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          created_at?: string
          directions?: Json
          id?: string
          is_primary?: boolean
          name: string
          organization_id: string
          postcode?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          city?: string | null
          created_at?: string
          directions?: Json
          id?: string
          is_primary?: boolean
          name?: string
          organization_id?: string
          postcode?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          dedupe_key: string
          error: string | null
          id: string
          language: Database["public"]["Enums"]["language_code"]
          organization_id: string
          payload: Json
          provider_message_id: string | null
          recipient: string
          send_after: string
          sent_at: string | null
          status: string
          template: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          dedupe_key: string
          error?: string | null
          id?: string
          language: Database["public"]["Enums"]["language_code"]
          organization_id: string
          payload?: Json
          provider_message_id?: string | null
          recipient: string
          send_after?: string
          sent_at?: string | null
          status?: string
          template: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key?: string
          error?: string | null
          id?: string
          language?: Database["public"]["Enums"]["language_code"]
          organization_id?: string
          payload?: Json
          provider_message_id?: string | null
          recipient?: string
          send_after?: string
          sent_at?: string | null
          status?: string
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_sessions: {
        Row: {
          answers: Json
          created_at: string
          created_by: string | null
          current_step: string
          id: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          created_by?: string | null
          current_step?: string
          id?: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          created_at?: string
          created_by?: string | null
          current_step?: string
          id?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_tasks: {
        Row: {
          attempts: number
          blocked_reason: string | null
          id: string
          kind: string
          last_error: string | null
          organization_id: string
          result: Json | null
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          blocked_reason?: string | null
          id?: string
          kind: string
          last_error?: string | null
          organization_id: string
          result?: Json | null
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          blocked_reason?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          organization_id?: string
          result?: Json | null
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "onboarding_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          additional_languages: Database["public"]["Enums"]["language_code"][]
          contact_email: string | null
          contact_phone_e164: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          fallback_phone_e164: string | null
          id: string
          industry_template_id: string
          name: string
          primary_language: Database["public"]["Enums"]["language_code"]
          reference_salt: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          timezone: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          additional_languages?: Database["public"]["Enums"]["language_code"][]
          contact_email?: string | null
          contact_phone_e164?: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          fallback_phone_e164?: string | null
          id?: string
          industry_template_id: string
          name: string
          primary_language: Database["public"]["Enums"]["language_code"]
          reference_salt?: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          timezone: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          additional_languages?: Database["public"]["Enums"]["language_code"][]
          contact_email?: string | null
          contact_phone_e164?: string | null
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          fallback_phone_e164?: string | null
          id?: string
          industry_template_id?: string
          name?: string
          primary_language?: Database["public"]["Enums"]["language_code"]
          reference_salt?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          timezone?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      phone_numbers: {
        Row: {
          after_hours_behavior: string
          agent_id: string | null
          connection_type: string
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          e164: string | null
          id: string
          organization_id: string
          provider: string
          provider_number_id: string | null
          status: Database["public"]["Enums"]["phone_number_status"]
          updated_at: string
        }
        Insert: {
          after_hours_behavior?: string
          agent_id?: string | null
          connection_type: string
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          e164?: string | null
          id?: string
          organization_id: string
          provider: string
          provider_number_id?: string | null
          status?: Database["public"]["Enums"]["phone_number_status"]
          updated_at?: string
        }
        Update: {
          after_hours_behavior?: string
          agent_id?: string | null
          connection_type?: string
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          e164?: string | null
          id?: string
          organization_id?: string
          provider?: string
          provider_number_id?: string | null
          status?: Database["public"]["Enums"]["phone_number_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_organization_id_agent_id_fkey"
            columns: ["organization_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "phone_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          allowed_capabilities: string[]
          code: string
          created_at: string
          currency: string
          hard_minute_cap: number | null
          included_agents: number
          included_locations: number
          included_minutes: number
          included_phone_numbers: number
          is_public: boolean
          name: string
          overage_per_minute_minor: number
          price_minor: number
          stripe_overage_price_id: string | null
          stripe_price_id: string | null
          support_tier: string
        }
        Insert: {
          active?: boolean
          allowed_capabilities: string[]
          code: string
          created_at?: string
          currency?: string
          hard_minute_cap?: number | null
          included_agents?: number
          included_locations?: number
          included_minutes: number
          included_phone_numbers?: number
          is_public?: boolean
          name: string
          overage_per_minute_minor: number
          price_minor: number
          stripe_overage_price_id?: string | null
          stripe_price_id?: string | null
          support_tier?: string
        }
        Update: {
          active?: boolean
          allowed_capabilities?: string[]
          code?: string
          created_at?: string
          currency?: string
          hard_minute_cap?: number | null
          included_agents?: number
          included_locations?: number
          included_minutes?: number
          included_phone_numbers?: number
          is_public?: boolean
          name?: string
          overage_per_minute_minor?: number
          price_minor?: number
          stripe_overage_price_id?: string | null
          stripe_price_id?: string | null
          support_tier?: string
        }
        Relationships: []
      }
      platform_staff: {
        Row: {
          created_at: string
          mfa_required: boolean
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          mfa_required?: boolean
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          mfa_required?: boolean
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          completed_at: string | null
          due_at: string
          id: string
          kind: string
          notes: string | null
          organization_id: string
          received_at: string
          status: string
          subject_email: string | null
          subject_phone_e164: string | null
        }
        Insert: {
          completed_at?: string | null
          due_at?: string
          id?: string
          kind: string
          notes?: string | null
          organization_id: string
          received_at?: string
          status?: string
          subject_email?: string | null
          subject_phone_e164?: string | null
        }
        Update: {
          completed_at?: string | null
          due_at?: string
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string
          received_at?: string
          status?: string
          subject_email?: string | null
          subject_phone_e164?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "privacy_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_cost_events: {
        Row: {
          amount_micros: number
          call_id: string | null
          component: string
          currency: string
          estimated: boolean
          id: number
          idempotency_key: string
          occurred_at: string
          organization_id: string | null
          provider: string
          quantity: number
          unit: string
        }
        Insert: {
          amount_micros: number
          call_id?: string | null
          component: string
          currency?: string
          estimated?: boolean
          id?: never
          idempotency_key: string
          occurred_at: string
          organization_id?: string | null
          provider: string
          quantity: number
          unit: string
        }
        Update: {
          amount_micros?: number
          call_id?: string | null
          component?: string
          currency?: string
          estimated?: boolean
          id?: never
          idempotency_key?: string
          occurred_at?: string
          organization_id?: string | null
          provider?: string
          quantity?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_cost_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policies: {
        Row: {
          call_metadata_days: number
          inactive_customer_days: number
          organization_id: string
          recording_days: number
          transcript_days: number
          updated_at: string
        }
        Insert: {
          call_metadata_days?: number
          inactive_customer_days?: number
          organization_id: string
          recording_days?: number
          transcript_days?: number
          updated_at?: string
        }
        Update: {
          call_metadata_days?: number
          inactive_customer_days?: number
          organization_id?: string
          recording_days?: number
          transcript_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_staff: {
        Row: {
          organization_id: string
          service_id: string
          staff_id: string
        }
        Insert: {
          organization_id: string
          service_id: string
          staff_id: string
        }
        Update: {
          organization_id?: string
          service_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_staff_organization_id_service_id_fkey"
            columns: ["organization_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "service_staff_organization_id_staff_id_fkey"
            columns: ["organization_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          aliases: string[]
          bookable_by_phone: boolean
          buffer_after_min: number
          buffer_before_min: number
          created_at: string
          currency: string
          duration_min: number
          id: string
          names: Json
          organization_id: string
          price_approved: boolean
          price_is_from: boolean
          price_minor: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          bookable_by_phone?: boolean
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          currency?: string
          duration_min: number
          id?: string
          names: Json
          organization_id: string
          price_approved?: boolean
          price_is_from?: boolean
          price_minor?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          bookable_by_phone?: boolean
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          currency?: string
          duration_min?: number
          id?: string
          names?: Json
          organization_id?: string
          price_approved?: boolean
          price_is_from?: boolean
          price_minor?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_hours: {
        Row: {
          ends: string
          id: string
          organization_id: string
          staff_id: string
          starts: string
          weekday: number
        }
        Insert: {
          ends: string
          id?: string
          organization_id: string
          staff_id: string
          starts: string
          weekday: number
        }
        Update: {
          ends?: string
          id?: string
          organization_id?: string
          staff_id?: string
          starts?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_hours_organization_id_staff_id_fkey"
            columns: ["organization_id", "staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      staff_members: {
        Row: {
          active: boolean
          aliases: string[]
          bookable: boolean
          calendar_connection_id: string | null
          created_at: string
          display_name: string
          external_calendar_id: string | null
          id: string
          location_id: string | null
          organization_id: string
          transfer_phone_e164: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          aliases?: string[]
          bookable?: boolean
          calendar_connection_id?: string | null
          created_at?: string
          display_name: string
          external_calendar_id?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          transfer_phone_e164?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          aliases?: string[]
          bookable?: boolean
          calendar_connection_id?: string | null
          created_at?: string
          display_name?: string
          external_calendar_id?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          transfer_phone_e164?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_organization_id_calendar_connection_id_fkey"
            columns: ["organization_id", "calendar_connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "staff_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          current_period_end: string | null
          current_period_start: string | null
          organization_id: string
          past_due_since: string | null
          plan_code: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          organization_id: string
          past_due_since?: string | null
          plan_code: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          organization_id?: string
          past_due_since?: string | null
          plan_code?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      usage_events: {
        Row: {
          call_id: string | null
          id: number
          idempotency_key: string
          metric: string
          occurred_at: string
          organization_id: string
          quantity: number
          reported_to_stripe_at: string | null
        }
        Insert: {
          call_id?: string | null
          id?: never
          idempotency_key: string
          metric: string
          occurred_at: string
          organization_id: string
          quantity: number
          reported_to_stripe_at?: string | null
        }
        Update: {
          call_id?: string | null
          id?: never
          idempotency_key?: string
          metric?: string
          occurred_at?: string
          organization_id?: string
          quantity?: number
          reported_to_stripe_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_monthly: {
        Row: {
          bookings: number
          call_seconds: number
          calls: number
          cost_micros_usd: number
          failed_bookings: number
          month: string
          organization_id: string
          refreshed_at: string
          transfers: number
        }
        Insert: {
          bookings?: number
          call_seconds?: number
          calls?: number
          cost_micros_usd?: number
          failed_bookings?: number
          month: string
          organization_id: string
          refreshed_at?: string
          transfers?: number
        }
        Update: {
          bookings?: number
          call_seconds?: number
          calls?: number
          cost_micros_usd?: number
          failed_bookings?: number
          month?: string
          organization_id?: string
          refreshed_at?: string
          transfers?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_monthly_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          error: string | null
          event_id: string
          event_type: string
          id: number
          payload: Json
          processed_at: string | null
          provider: string
          received_at: string
          signature_valid: boolean
          status: string
        }
        Insert: {
          error?: string | null
          event_id: string
          event_type: string
          id?: never
          payload: Json
          processed_at?: string | null
          provider: string
          received_at?: string
          signature_valid: boolean
          status?: string
        }
        Update: {
          error?: string | null
          event_id?: string
          event_type?: string
          id?: never
          payload?: Json
          processed_at?: string | null
          provider?: string
          received_at?: string
          signature_valid?: boolean
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      agent_version_status: "draft" | "testing" | "published" | "archived"
      booking_status:
        | "requested"
        | "validating"
        | "holding"
        | "committing"
        | "confirmed"
        | "needs_reconciliation"
        | "failed"
        | "expired"
        | "cancelled"
        | "completed"
        | "no_show"
      country_code: "IE" | "HR"
      integration_provider:
        | "google_calendar"
        | "microsoft_calendar"
        | "calcom"
        | "webhook"
      integration_status:
        | "pending_authorization"
        | "connected"
        | "error"
        | "revoked"
      knowledge_status: "draft" | "pending_review" | "approved" | "archived"
      language_code: "en" | "hr"
      member_role: "owner" | "manager" | "receptionist" | "analyst"
      org_status: "onboarding" | "trial" | "active" | "suspended" | "closed"
      phone_number_status:
        | "requested"
        | "pending_regulatory"
        | "porting"
        | "provisioning"
        | "active"
        | "suspended"
        | "released"
      platform_role: "platform_admin" | "platform_support"
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
  public: {
    Enums: {
      agent_version_status: ["draft", "testing", "published", "archived"],
      booking_status: [
        "requested",
        "validating",
        "holding",
        "committing",
        "confirmed",
        "needs_reconciliation",
        "failed",
        "expired",
        "cancelled",
        "completed",
        "no_show",
      ],
      country_code: ["IE", "HR"],
      integration_provider: [
        "google_calendar",
        "microsoft_calendar",
        "calcom",
        "webhook",
      ],
      integration_status: [
        "pending_authorization",
        "connected",
        "error",
        "revoked",
      ],
      knowledge_status: ["draft", "pending_review", "approved", "archived"],
      language_code: ["en", "hr"],
      member_role: ["owner", "manager", "receptionist", "analyst"],
      org_status: ["onboarding", "trial", "active", "suspended", "closed"],
      phone_number_status: [
        "requested",
        "pending_regulatory",
        "porting",
        "provisioning",
        "active",
        "suspended",
        "released",
      ],
      platform_role: ["platform_admin", "platform_support"],
    },
  },
} as const
