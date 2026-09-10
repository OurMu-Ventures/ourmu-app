export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  private: {
    Tables: {
      investor_identities: {
        Row: {
          application_id: string | null
          created_at: string
          erased_at: string | null
          id: string
          key_version: number
          nin_auth_tag: string | null
          nin_ciphertext: string | null
          nin_fingerprint: string | null
          nin_iv: string | null
          nin_last_four: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          erased_at?: string | null
          id?: string
          key_version: number
          nin_auth_tag?: string | null
          nin_ciphertext?: string | null
          nin_fingerprint?: string | null
          nin_iv?: string | null
          nin_last_four?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          application_id?: string | null
          created_at?: string
          erased_at?: string | null
          id?: string
          key_version?: number
          nin_auth_tag?: string | null
          nin_ciphertext?: string | null
          nin_fingerprint?: string | null
          nin_iv?: string | null
          nin_last_four?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { check_user_id?: string }; Returns: boolean }
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
      account_closure_requests: {
        Row: {
          id: string
          reason: string | null
          requested_at: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["closure_status"]
          user_id: string
        }
        Insert: {
          id?: string
          reason?: string | null
          requested_at?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["closure_status"]
          user_id: string
        }
        Update: {
          id?: string
          reason?: string | null
          requested_at?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["closure_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_closure_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_closure_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          content_hash: string
          created_at: string
          id: string
          is_legally_approved: boolean
          published_at: string | null
          template_markdown: string
          title: string
          version: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          content_hash: string
          created_at?: string
          id?: string
          is_legally_approved?: boolean
          published_at?: string | null
          template_markdown: string
          title: string
          version: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          content_hash?: string
          created_at?: string
          id?: string
          is_legally_approved?: boolean
          published_at?: string | null
          template_markdown?: string
          title?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_versions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      application_invitations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invited_email: string
          issued_by: string
          revoked_at: string | null
          supersedes_id: string | null
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          invited_email: string
          issued_by: string
          revoked_at?: string | null
          supersedes_id?: string | null
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invited_email?: string
          issued_by?: string
          revoked_at?: string | null
          supersedes_id?: string | null
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_invitations_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_invitations_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "application_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          request_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          request_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          request_id?: string
        }
        Relationships: []
      }
      bank_instructions: {
        Row: {
          account_name: string
          account_number: string
          bank_name: string
          branch: string | null
          created_at: string
          created_by: string
          id: string
          instructions: string
          is_active: boolean
          swift_code: string | null
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number: string
          bank_name: string
          branch?: string | null
          created_at?: string
          created_by: string
          id?: string
          instructions: string
          is_active?: boolean
          swift_code?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          bank_name?: string
          branch?: string | null
          created_at?: string
          created_by?: string
          id?: string
          instructions?: string
          is_active?: boolean
          swift_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_instructions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_receipts: {
        Row: {
          activated_at: string
          bank_reference: string
          created_at: string
          id: string
          investment_id: string
          received_amount_ugx: number
          received_date: string
          recorded_by: string
        }
        Insert: {
          activated_at: string
          bank_reference: string
          created_at?: string
          id?: string
          investment_id: string
          received_amount_ugx: number
          received_date: string
          recorded_by: string
        }
        Update: {
          activated_at?: string
          bank_reference?: string
          created_at?: string
          id?: string
          investment_id?: string
          received_amount_ugx?: number
          received_date?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_receipts_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: true
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_receipts_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          cycle_count: number
          failure_code: string | null
          id: string
          investment_count: number
          monthly_summary_count: number
          partner_count: number
          payout_total_ugx: number
          principal_total_ugx: number
          profile_count: number
          return_total_ugx: number
          source_filename: string
          source_sha256: string
          staged_at: string
          staged_by: string
          status: Database["public"]["Enums"]["import_batch_status"]
          unclaimed_count: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          cycle_count: number
          failure_code?: string | null
          id: string
          investment_count: number
          monthly_summary_count: number
          partner_count: number
          payout_total_ugx: number
          principal_total_ugx: number
          profile_count: number
          return_total_ugx: number
          source_filename: string
          source_sha256: string
          staged_at?: string
          staged_by: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          unclaimed_count: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          cycle_count?: number
          failure_code?: string | null
          id?: string
          investment_count?: number
          monthly_summary_count?: number
          partner_count?: number
          payout_total_ugx?: number
          principal_total_ugx?: number
          profile_count?: number
          return_total_ugx?: number
          source_filename?: string
          source_sha256?: string
          staged_at?: string
          staged_by?: string
          status?: Database["public"]["Enums"]["import_batch_status"]
          unclaimed_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_staged_by_fkey"
            columns: ["staged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_agreements: {
        Row: {
          acceptance_request_id: string
          accepted_at: string
          accepted_content_hash: string
          accepted_ip_fingerprint: string
          accepted_user_agent: string
          agreement_version_id: string
          created_at: string
          generated_at: string | null
          id: string
          investment_id: string
          investor_id: string
          pdf_hash: string | null
          pdf_path: string | null
          pdf_status: Database["public"]["Enums"]["agreement_status"]
        }
        Insert: {
          acceptance_request_id: string
          accepted_at: string
          accepted_content_hash: string
          accepted_ip_fingerprint: string
          accepted_user_agent: string
          agreement_version_id: string
          created_at?: string
          generated_at?: string | null
          id?: string
          investment_id: string
          investor_id: string
          pdf_hash?: string | null
          pdf_path?: string | null
          pdf_status?: Database["public"]["Enums"]["agreement_status"]
        }
        Update: {
          acceptance_request_id?: string
          accepted_at?: string
          accepted_content_hash?: string
          accepted_ip_fingerprint?: string
          accepted_user_agent?: string
          agreement_version_id?: string
          created_at?: string
          generated_at?: string | null
          id?: string
          investment_id?: string
          investor_id?: string
          pdf_hash?: string | null
          pdf_path?: string | null
          pdf_status?: Database["public"]["Enums"]["agreement_status"]
        }
        Relationships: [
          {
            foreignKeyName: "investment_agreements_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_agreements_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: true
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_agreements_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_cycles: {
        Row: {
          agreement_version_id: string | null
          capacity_ugx: number | null
          capacity_units: number | null
          closes_at: string
          created_at: string
          created_by: string
          id: string
          import_batch_id: string | null
          maturity_date: string
          name: string
          opens_at: string
          projected_return_bps: number
          record_origin: Database["public"]["Enums"]["record_origin"]
          status: Database["public"]["Enums"]["cycle_status"]
          unit_price_ugx: number
          updated_at: string
        }
        Insert: {
          agreement_version_id?: string | null
          capacity_ugx?: number | null
          capacity_units?: number | null
          closes_at: string
          created_at?: string
          created_by: string
          id?: string
          import_batch_id?: string | null
          maturity_date: string
          name: string
          opens_at: string
          projected_return_bps?: number
          record_origin?: Database["public"]["Enums"]["record_origin"]
          status?: Database["public"]["Enums"]["cycle_status"]
          unit_price_ugx?: number
          updated_at?: string
        }
        Update: {
          agreement_version_id?: string | null
          capacity_ugx?: number | null
          capacity_units?: number | null
          closes_at?: string
          created_at?: string
          created_by?: string
          id?: string
          import_batch_id?: string | null
          maturity_date?: string
          name?: string
          opens_at?: string
          projected_return_bps?: number
          record_origin?: Database["public"]["Enums"]["record_origin"]
          status?: Database["public"]["Enums"]["cycle_status"]
          unit_price_ugx?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_cycles_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_cycles_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      investments: {
        Row: {
          activated_at: string | null
          cancelled_at: string | null
          created_at: string
          cycle_id: string
          id: string
          import_batch_id: string | null
          investor_id: string | null
          legacy_partner_id: string | null
          matured_at: string | null
          maturity_date: string
          payout_basis: Database["public"]["Enums"]["payout_basis"]
          principal_ugx: number
          projected_return_bps: number
          projected_return_ugx: number
          projected_value_ugx: number
          record_origin: Database["public"]["Enums"]["record_origin"]
          reported_payout_ugx: number | null
          reported_return_ugx: number | null
          requested_at: string
          reservation_expires_at: string | null
          source_key: string | null
          source_row: number | null
          source_sheet: string | null
          status: Database["public"]["Enums"]["investment_status"]
          unit_price_ugx: number
          units: number | null
        }
        Insert: {
          activated_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          cycle_id: string
          id?: string
          import_batch_id?: string | null
          investor_id?: string | null
          legacy_partner_id?: string | null
          matured_at?: string | null
          maturity_date: string
          payout_basis?: Database["public"]["Enums"]["payout_basis"]
          principal_ugx: number
          projected_return_bps: number
          projected_return_ugx: number
          projected_value_ugx: number
          record_origin?: Database["public"]["Enums"]["record_origin"]
          reported_payout_ugx?: number | null
          reported_return_ugx?: number | null
          requested_at?: string
          reservation_expires_at?: string | null
          source_key?: string | null
          source_row?: number | null
          source_sheet?: string | null
          status?: Database["public"]["Enums"]["investment_status"]
          unit_price_ugx: number
          units?: number | null
        }
        Update: {
          activated_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          cycle_id?: string
          id?: string
          import_batch_id?: string | null
          investor_id?: string | null
          legacy_partner_id?: string | null
          matured_at?: string | null
          maturity_date?: string
          payout_basis?: Database["public"]["Enums"]["payout_basis"]
          principal_ugx?: number
          projected_return_bps?: number
          projected_return_ugx?: number
          projected_value_ugx?: number
          record_origin?: Database["public"]["Enums"]["record_origin"]
          reported_payout_ugx?: number | null
          reported_return_ugx?: number | null
          requested_at?: string
          reservation_expires_at?: string | null
          source_key?: string | null
          source_row?: number | null
          source_sheet?: string | null
          status?: Database["public"]["Enums"]["investment_status"]
          unit_price_ugx?: number
          units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "investments_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "investment_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_legacy_partner_id_fkey"
            columns: ["legacy_partner_id"]
            isOneToOne: false
            referencedRelation: "legacy_partner_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      investor_applications: {
        Row: {
          address: string
          anonymized_at: string | null
          auth_user_id: string | null
          country: string
          created_at: string
          date_of_birth: string
          district: string
          email: string
          id: string
          invitation_id: string
          kyc_notes: string | null
          kyc_verification_reference: string | null
          legal_name: string
          phone: string
          privacy_consented_at: string
          privacy_policy_version: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          address: string
          anonymized_at?: string | null
          auth_user_id?: string | null
          country?: string
          created_at?: string
          date_of_birth: string
          district: string
          email: string
          id?: string
          invitation_id: string
          kyc_notes?: string | null
          kyc_verification_reference?: string | null
          legal_name: string
          phone: string
          privacy_consented_at: string
          privacy_policy_version: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          address?: string
          anonymized_at?: string | null
          auth_user_id?: string | null
          country?: string
          created_at?: string
          date_of_birth?: string
          district?: string
          email?: string
          id?: string
          invitation_id?: string
          kyc_notes?: string | null
          kyc_verification_reference?: string | null
          legal_name?: string
          phone?: string
          privacy_consented_at?: string
          privacy_policy_version?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_applications_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: true
            referencedRelation: "application_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investor_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          kind: Database["public"]["Enums"]["job_kind"]
          last_error_code: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          kind: Database["public"]["Enums"]["job_kind"]
          last_error_code?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          last_error_code?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: []
      }
      legacy_monthly_financial_summaries: {
        Row: {
          created_at: string
          entry_count: number
          id: string
          import_batch_id: string
          month_label: string
          month_start: string
          ourmu_receivable_ugx: number
          partner_return_ugx: number
          payout_ugx: number
          profit_margin_ugx: number
          total_investment_ugx: number
        }
        Insert: {
          created_at?: string
          entry_count: number
          id: string
          import_batch_id: string
          month_label: string
          month_start: string
          ourmu_receivable_ugx: number
          partner_return_ugx: number
          payout_ugx: number
          profit_margin_ugx: number
          total_investment_ugx: number
        }
        Update: {
          created_at?: string
          entry_count?: number
          id?: string
          import_batch_id?: string
          month_label?: string
          month_start?: string
          ourmu_receivable_ugx?: number
          partner_return_ugx?: number
          payout_ugx?: number
          profit_margin_ugx?: number
          total_investment_ugx?: number
        }
        Relationships: [
          {
            foreignKeyName: "legacy_monthly_financial_summaries_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_partner_identities: {
        Row: {
          canonical_name: string
          created_at: string
          id: string
          import_batch_id: string
          normalized_email: string | null
          normalized_phone: string | null
          profile_id: string | null
          source_aliases: Json
          source_rows: Json
        }
        Insert: {
          canonical_name: string
          created_at?: string
          id: string
          import_batch_id: string
          normalized_email?: string | null
          normalized_phone?: string | null
          profile_id?: string | null
          source_aliases?: Json
          source_rows?: Json
        }
        Update: {
          canonical_name?: string
          created_at?: string
          id?: string
          import_batch_id?: string
          normalized_email?: string | null
          normalized_phone?: string | null
          profile_id?: string | null
          source_aliases?: Json
          source_rows?: Json
        }
        Relationships: [
          {
            foreignKeyName: "legacy_partner_identities_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_partner_identities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      next_of_kin: {
        Row: {
          address: string
          created_at: string
          email: string | null
          id: string
          legal_name: string
          phone: string
          relationship: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          email?: string | null
          id?: string
          legal_name: string
          phone: string
          relationship: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          email?: string | null
          id?: string
          legal_name?: string
          phone?: string
          relationship?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "next_of_kin_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_status: Database["public"]["Enums"]["access_status"]
          address: string | null
          country: string
          created_at: string
          date_of_birth: string | null
          district: string | null
          email: string
          id: string
          import_batch_id: string | null
          kyc_status: string
          kyc_verified_at: string | null
          legal_name: string
          onboarding_completed_at: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          access_status?: Database["public"]["Enums"]["access_status"]
          address?: string | null
          country?: string
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          email: string
          id: string
          import_batch_id?: string | null
          kyc_status?: string
          kyc_verified_at?: string | null
          legal_name: string
          onboarding_completed_at?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          access_status?: Database["public"]["Enums"]["access_status"]
          address?: string | null
          country?: string
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          email?: string
          id?: string
          import_batch_id?: string | null
          kyc_status?: string
          kyc_verified_at?: string | null
          legal_name?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_partner_import: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_batch_id: string
          p_confirmation: string
          p_request_id: string
        }
        Returns: Json
      }
      activate_investment: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_bank_reference: string
          p_confirmation: string
          p_investment_id: string
          p_received_amount_ugx: number
          p_received_date: string
          p_request_id: string
        }
        Returns: undefined
      }
      cancel_investment: {
        Args: {
          p_investment_id: string
          p_investor_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      link_legacy_partner: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_auth_user_id: string
          p_confirmation: string
          p_email: string
          p_legacy_partner_id: string
          p_phone: string
          p_request_id: string
        }
        Returns: undefined
      }
      request_investment: {
        Args: {
          p_cycle_id: string
          p_investor_id: string
          p_ip_fingerprint: string
          p_principal_ugx: number
          p_request_id: string
          p_user_agent: string
        }
        Returns: string
      }
      run_maintenance: { Args: { p_request_id: string }; Returns: Json }
      stage_partner_import: {
        Args: { p_admin_id: string; p_manifest: Json; p_request_id: string }
        Returns: string
      }
    }
    Enums: {
      access_status: "active" | "disabled" | "closed"
      agreement_status: "accepted" | "generating" | "ready" | "failed"
      application_status: "submitted" | "approved" | "rejected" | "abandoned"
      closure_status: "requested" | "resolved" | "declined"
      cycle_status: "draft" | "open" | "closed" | "matured"
      import_batch_status: "staged" | "accepted" | "failed"
      investment_status:
        | "reserved"
        | "active"
        | "cancelled"
        | "rejected"
        | "expired"
        | "matured"
      job_kind: "send_email" | "generate_agreement_pdf" | "revoke_sessions"
      job_status: "pending" | "running" | "succeeded" | "failed" | "dead"
      payout_basis: "projected" | "reported_paid"
      record_origin: "portal" | "legacy_import" | "hybrid"
      user_role: "investor" | "admin"
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
  private: {
    Enums: {},
  },
  public: {
    Enums: {
      access_status: ["active", "disabled", "closed"],
      agreement_status: ["accepted", "generating", "ready", "failed"],
      application_status: ["submitted", "approved", "rejected", "abandoned"],
      closure_status: ["requested", "resolved", "declined"],
      cycle_status: ["draft", "open", "closed", "matured"],
      import_batch_status: ["staged", "accepted", "failed"],
      investment_status: [
        "reserved",
        "active",
        "cancelled",
        "rejected",
        "expired",
        "matured",
      ],
      job_kind: ["send_email", "generate_agreement_pdf", "revoke_sessions"],
      job_status: ["pending", "running", "succeeded", "failed", "dead"],
      payout_basis: ["projected", "reported_paid"],
      record_origin: ["portal", "legacy_import", "hybrid"],
      user_role: ["investor", "admin"],
    },
  },
} as const
