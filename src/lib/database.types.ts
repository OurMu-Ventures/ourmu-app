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
      alias_login_attempts: {
        Row: {
          id: number
          ip_fingerprint: string
          requested_at: string
          user_id: string
        }
        Insert: {
          id?: never
          ip_fingerprint: string
          requested_at?: string
          user_id: string
        }
        Update: {
          id?: never
          ip_fingerprint?: string
          requested_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      queued_email_reservations: {
        Row: {
          daily_reserved_at: string
          delivery_key: string
          job_id: string
          recipients: number
          reserved_at: string
        }
        Insert: {
          daily_reserved_at?: string
          delivery_key: string
          job_id: string
          recipients: number
          reserved_at?: string
        }
        Update: {
          daily_reserved_at?: string
          delivery_key?: string
          job_id?: string
          recipients?: number
          reserved_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_receipt_number: { Args: { p_is_test: boolean }; Returns: string }
      cycle_actual_return_locked: {
        Args: { p_at?: string; p_maturity_date: string }
        Returns: boolean
      }
      cycle_actual_return_state: {
        Args: {
          p_actual_return_bps: number
          p_at?: string
          p_cycle: Database["public"]["Tables"]["investment_cycles"]["Row"]
        }
        Returns: Json
      }
      cycle_actual_return_ugx: {
        Args: { p_actual_return_bps: number; p_principal_ugx: number }
        Returns: number
      }
      cycle_return_totals: {
        Args: { p_actual_return_bps: number; p_cycle_id: string }
        Returns: {
          actual_profit_ugx: number
          investment_count: number
          principal_ugx: number
          projected_profit_ugx: number
          test_investment_count: number
          total_value_ugx: number
        }[]
      }
      cycle_settlement_started: {
        Args: { p_cycle_id: string }
        Returns: boolean
      }
      is_accepted_import_batch: {
        Args: { check_batch_id: string }
        Returns: boolean
      }
      is_admin: { Args: { check_user_id?: string }; Returns: boolean }
      kampala_date: { Args: { p_at?: string }; Returns: string }
      resolve_portal_cycle: { Args: { p_at: string }; Returns: string }
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
      account_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          is_primary: boolean
          updated_at: string
          user_id: string
          verification_expires_at: string | null
          verification_sent_at: string | null
          verification_token_hash: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          user_id: string
          verification_expires_at?: string | null
          verification_sent_at?: string | null
          verification_token_hash?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          user_id?: string
          verification_expires_at?: string | null
          verification_sent_at?: string | null
          verification_token_hash?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_emails_user_id_fkey"
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
          received_at: string | null
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
          received_at?: string | null
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
          received_at?: string | null
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
      email_campaigns: {
        Row: {
          admin_count: number | null
          campaign_key: string
          created_at: string
          created_by: string | null
          id: string
          partner_count: number | null
          recipient_count: number | null
          released_at: string | null
          released_by: string | null
          status: string
          test_provider_message_id: string | null
          test_sent_at: string | null
        }
        Insert: {
          admin_count?: number | null
          campaign_key: string
          created_at?: string
          created_by?: string | null
          id?: string
          partner_count?: number | null
          recipient_count?: number | null
          released_at?: string | null
          released_by?: string | null
          status?: string
          test_provider_message_id?: string | null
          test_sent_at?: string | null
        }
        Update: {
          admin_count?: number | null
          campaign_key?: string
          created_at?: string
          created_by?: string | null
          id?: string
          partner_count?: number | null
          recipient_count?: number | null
          released_at?: string | null
          released_by?: string | null
          status?: string
          test_provider_message_id?: string | null
          test_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_released_by_fkey"
            columns: ["released_by"]
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
          actual_return_bps: number | null
          actual_return_late_entry: boolean
          actual_return_recorded_at: string | null
          actual_return_recorded_by: string | null
          actual_return_revision: number
          agreement_version_id: string | null
          capacity_ugx: number | null
          capacity_units: number | null
          closes_at: string
          created_at: string
          created_by: string
          id: string
          import_batch_id: string | null
          legacy_settlement: boolean
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
          actual_return_bps?: number | null
          actual_return_late_entry?: boolean
          actual_return_recorded_at?: string | null
          actual_return_recorded_by?: string | null
          actual_return_revision?: number
          agreement_version_id?: string | null
          capacity_ugx?: number | null
          capacity_units?: number | null
          closes_at: string
          created_at?: string
          created_by: string
          id?: string
          import_batch_id?: string | null
          legacy_settlement?: boolean
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
          actual_return_bps?: number | null
          actual_return_late_entry?: boolean
          actual_return_recorded_at?: string | null
          actual_return_recorded_by?: string | null
          actual_return_revision?: number
          agreement_version_id?: string | null
          capacity_ugx?: number | null
          capacity_units?: number | null
          closes_at?: string
          created_at?: string
          created_by?: string
          id?: string
          import_batch_id?: string | null
          legacy_settlement?: boolean
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
            foreignKeyName: "investment_cycles_actual_return_recorded_by_fkey"
            columns: ["actual_return_recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      investment_receipts: {
        Row: {
          offline_authorization_id: string | null
          account_description: string
          amount_ugx: number
          bank_receipt_id: string | null
          company_address: string
          company_name: string
          created_at: string
          generated_at: string | null
          id: string
          investment_id: string
          investor_id: string | null
          is_test: boolean
          last_error_code: string | null
          maturity_instruction_id: string | null
          original_investment_id: string | null
          partner_name: string
          partner_phone: string | null
          pdf_hash: string | null
          pdf_path: string | null
          pdf_status: Database["public"]["Enums"]["receipt_status"]
          receipt_number: string
          source: Database["public"]["Enums"]["receipt_source"]
          template_version: string
          transaction_date: string
          updated_at: string
        }
        Insert: {
          offline_authorization_id?: string | null
          account_description: string
          amount_ugx: number
          bank_receipt_id?: string | null
          company_address: string
          company_name: string
          created_at?: string
          generated_at?: string | null
          id?: string
          investment_id: string
          investor_id?: string | null
          is_test?: boolean
          last_error_code?: string | null
          maturity_instruction_id?: string | null
          original_investment_id?: string | null
          partner_name: string
          partner_phone?: string | null
          pdf_hash?: string | null
          pdf_path?: string | null
          pdf_status?: Database["public"]["Enums"]["receipt_status"]
          receipt_number: string
          source: Database["public"]["Enums"]["receipt_source"]
          template_version?: string
          transaction_date: string
          updated_at?: string
        }
        Update: {
          offline_authorization_id?: string | null
          account_description?: string
          amount_ugx?: number
          bank_receipt_id?: string | null
          company_address?: string
          company_name?: string
          created_at?: string
          generated_at?: string | null
          id?: string
          investment_id?: string
          investor_id?: string | null
          is_test?: boolean
          last_error_code?: string | null
          maturity_instruction_id?: string | null
          original_investment_id?: string | null
          partner_name?: string
          partner_phone?: string | null
          pdf_hash?: string | null
          pdf_path?: string | null
          pdf_status?: Database["public"]["Enums"]["receipt_status"]
          receipt_number?: string
          source?: Database["public"]["Enums"]["receipt_source"]
          template_version?: string
          transaction_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_receipts_bank_receipt_id_fkey"
            columns: ["bank_receipt_id"]
            isOneToOne: false
            referencedRelation: "bank_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_receipts_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: true
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_receipts_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_receipts_maturity_instruction_id_fkey"
            columns: ["maturity_instruction_id"]
            isOneToOne: false
            referencedRelation: "maturity_instructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_receipts_original_investment_id_fkey"
            columns: ["original_investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
        ]
      }
      investments: {
        Row: {
          offline_settlement_id: string | null
          administratively_archived_at: string | null
          offline_authorization_id: string | null
          activated_at: string | null
          alias: string | null
          cancelled_at: string | null
          created_at: string
          cycle_id: string
          id: string
          import_batch_id: string | null
          investor_id: string | null
          is_test: boolean
          legacy_partner_id: string | null
          matured_at: string | null
          maturity_date: string
          payout_basis: Database["public"]["Enums"]["payout_basis"]
          policy_version: string | null
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
          offline_settlement_id?: string | null
          administratively_archived_at?: string | null
          offline_authorization_id?: string | null
          activated_at?: string | null
          alias?: string | null
          cancelled_at?: string | null
          created_at?: string
          cycle_id: string
          id?: string
          import_batch_id?: string | null
          investor_id?: string | null
          is_test?: boolean
          legacy_partner_id?: string | null
          matured_at?: string | null
          maturity_date: string
          payout_basis?: Database["public"]["Enums"]["payout_basis"]
          policy_version?: string | null
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
          offline_settlement_id?: string | null
          administratively_archived_at?: string | null
          offline_authorization_id?: string | null
          activated_at?: string | null
          alias?: string | null
          cancelled_at?: string | null
          created_at?: string
          cycle_id?: string
          id?: string
          import_batch_id?: string | null
          investor_id?: string | null
          is_test?: boolean
          legacy_partner_id?: string | null
          matured_at?: string | null
          maturity_date?: string
          payout_basis?: Database["public"]["Enums"]["payout_basis"]
          policy_version?: string | null
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
          cc_review_required: boolean
          claim_token: string | null
          completed_at: string | null
          created_at: string
          email_dedupe_key: string | null
          entity_id: string
          entity_type: string
          first_send_attempt_at: string | null
          id: string
          kind: Database["public"]["Enums"]["job_kind"]
          last_error_code: string | null
          lease_expires_at: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          provider_message_id: string | null
          send_attempts: number
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          cc_review_required?: boolean
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          email_dedupe_key?: string | null
          entity_id: string
          entity_type: string
          first_send_attempt_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["job_kind"]
          last_error_code?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          provider_message_id?: string | null
          send_attempts?: number
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          cc_review_required?: boolean
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          email_dedupe_key?: string | null
          entity_id?: string
          entity_type?: string
          first_send_attempt_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          last_error_code?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          provider_message_id?: string | null
          send_attempts?: number
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
      maturity_email_settings: {
        Row: {
          contacts: string[]
          enabled: boolean
          id: boolean
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          contacts?: string[]
          enabled?: boolean
          id?: boolean
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          contacts?: string[]
          enabled?: boolean
          id?: boolean
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maturity_email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maturity_instructions: {
        Row: {
          acceptance_captured_at: string | null
          acceptance_ip_fingerprint: string | null
          acceptance_request_id: string | null
          acceptance_user_agent: string | null
          actual_payout_ugx: number | null
          actual_reinvest_ugx: number | null
          actual_roi_ugx: number | null
          agreement_accepted: boolean
          amount_basis: string
          basis_actual_return_bps: number | null
          choice: Database["public"]["Enums"]["maturity_choice"]
          confirmed_actual_roi_ugx: number | null
          created_at: string
          destination_confirmed: boolean
          destination_verified: boolean
          destination_verified_at: string | null
          fulfilled_at: string | null
          fulfilled_investment_id: string | null
          id: string
          investment_id: string
          investor_id: string
          needs_resolution: boolean
          payout_destination_id: string | null
          payout_reference: string | null
          payout_verified_at: string | null
          policy_version: string | null
          processed_at: string | null
          processed_by: string | null
          projected_payout_ugx: number
          projected_reinvest_ugx: number
          proposed_actual_roi_ugx: number | null
          request_id: string
          requested_withdrawal_ugx: number | null
          resolution_notes: string | null
          revision_count: number
          standing_authorization_id: string | null
          status: Database["public"]["Enums"]["maturity_instruction_status"]
          target_agreement_version_id: string | null
          target_cycle_id: string | null
          updated_at: string
        }
        Insert: {
          acceptance_captured_at?: string | null
          acceptance_ip_fingerprint?: string | null
          acceptance_request_id?: string | null
          acceptance_user_agent?: string | null
          actual_payout_ugx?: number | null
          actual_reinvest_ugx?: number | null
          actual_roi_ugx?: number | null
          agreement_accepted?: boolean
          amount_basis?: string
          basis_actual_return_bps?: number | null
          choice: Database["public"]["Enums"]["maturity_choice"]
          confirmed_actual_roi_ugx?: number | null
          created_at?: string
          destination_confirmed?: boolean
          destination_verified?: boolean
          destination_verified_at?: string | null
          fulfilled_at?: string | null
          fulfilled_investment_id?: string | null
          id?: string
          investment_id: string
          investor_id: string
          needs_resolution?: boolean
          payout_destination_id?: string | null
          payout_reference?: string | null
          payout_verified_at?: string | null
          policy_version?: string | null
          processed_at?: string | null
          processed_by?: string | null
          projected_payout_ugx: number
          projected_reinvest_ugx: number
          proposed_actual_roi_ugx?: number | null
          request_id: string
          requested_withdrawal_ugx?: number | null
          resolution_notes?: string | null
          revision_count?: number
          standing_authorization_id?: string | null
          status?: Database["public"]["Enums"]["maturity_instruction_status"]
          target_agreement_version_id?: string | null
          target_cycle_id?: string | null
          updated_at?: string
        }
        Update: {
          acceptance_captured_at?: string | null
          acceptance_ip_fingerprint?: string | null
          acceptance_request_id?: string | null
          acceptance_user_agent?: string | null
          actual_payout_ugx?: number | null
          actual_reinvest_ugx?: number | null
          actual_roi_ugx?: number | null
          agreement_accepted?: boolean
          amount_basis?: string
          basis_actual_return_bps?: number | null
          choice?: Database["public"]["Enums"]["maturity_choice"]
          confirmed_actual_roi_ugx?: number | null
          created_at?: string
          destination_confirmed?: boolean
          destination_verified?: boolean
          destination_verified_at?: string | null
          fulfilled_at?: string | null
          fulfilled_investment_id?: string | null
          id?: string
          investment_id?: string
          investor_id?: string
          needs_resolution?: boolean
          payout_destination_id?: string | null
          payout_reference?: string | null
          payout_verified_at?: string | null
          policy_version?: string | null
          processed_at?: string | null
          processed_by?: string | null
          projected_payout_ugx?: number
          projected_reinvest_ugx?: number
          proposed_actual_roi_ugx?: number | null
          request_id?: string
          requested_withdrawal_ugx?: number | null
          resolution_notes?: string | null
          revision_count?: number
          standing_authorization_id?: string | null
          status?: Database["public"]["Enums"]["maturity_instruction_status"]
          target_agreement_version_id?: string | null
          target_cycle_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maturity_instructions_fulfilled_investment_id_fkey"
            columns: ["fulfilled_investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_instructions_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: true
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_instructions_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_instructions_payout_destination_id_fkey"
            columns: ["payout_destination_id"]
            isOneToOne: false
            referencedRelation: "payout_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_instructions_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_instructions_standing_authorization_id_fkey"
            columns: ["standing_authorization_id"]
            isOneToOne: false
            referencedRelation: "maturity_reinvest_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_instructions_target_agreement_version_id_fkey"
            columns: ["target_agreement_version_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_instructions_target_cycle_id_fkey"
            columns: ["target_cycle_id"]
            isOneToOne: false
            referencedRelation: "investment_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      maturity_policy_gates: {
        Row: {
          enabled: boolean
          name: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          name: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maturity_policy_gates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      maturity_reinvest_authorizations: {
        Row: {
          acceptance_request_id: string
          accepted_content_hash: string
          accepted_ip_fingerprint: string
          accepted_user_agent: string
          agreement_version_id: string
          authorized_at: string
          authorized_by: string | null
          created_at: string
          id: string
          investor_id: string
          revoked_at: string | null
          scope: string
        }
        Insert: {
          acceptance_request_id: string
          accepted_content_hash: string
          accepted_ip_fingerprint: string
          accepted_user_agent: string
          agreement_version_id: string
          authorized_at?: string
          authorized_by?: string | null
          created_at?: string
          id?: string
          investor_id: string
          revoked_at?: string | null
          scope?: string
        }
        Update: {
          acceptance_request_id?: string
          accepted_content_hash?: string
          accepted_ip_fingerprint?: string
          accepted_user_agent?: string
          agreement_version_id?: string
          authorized_at?: string
          authorized_by?: string | null
          created_at?: string
          id?: string
          investor_id?: string
          revoked_at?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "maturity_reinvest_authorizations_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_reinvest_authorizations_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maturity_reinvest_authorizations_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_visits: {
        Row: {
          newsletter_slug: string
          opened_at: string
          partner_id: string
          reached_end_at: string | null
          visit_id: string
        }
        Insert: {
          newsletter_slug: string
          opened_at?: string
          partner_id: string
          reached_end_at?: string | null
          visit_id: string
        }
        Update: {
          newsletter_slug?: string
          opened_at?: string
          partner_id?: string
          reached_end_at?: string | null
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_visits_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
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
      offline_reinvestment_authorizations: {
        Row: {
          target_maturity_date: string
          target_return_bps: number
          identity_verified: boolean
          settlement_checked: boolean
          agreement_accepted_offline: boolean
          id: string
          investment_id: string
          legacy_partner_id: string
          target_cycle_id: string
          agreement_version_id: string
          agreement_hash: string
          principal_ugx: number
          actual_roi_ugx: number
          amount_ugx: number
          authorized_on: string
          method: string
          evidence_reference: string
          verification_notes: string
          recorded_by: string
          recorded_at: string
          request_id: string
          status: string
          fulfilled_investment_id: string | null
          fulfilled_by: string | null
          fulfilled_at: string | null
          revoked_by: string | null
          revoked_at: string | null
          revocation_reason: string | null
        }
        Insert: {
          target_maturity_date: string
          target_return_bps: number
          identity_verified: boolean
          settlement_checked: boolean
          agreement_accepted_offline: boolean
          id?: string
          investment_id: string
          legacy_partner_id: string
          target_cycle_id: string
          agreement_version_id: string
          agreement_hash: string
          principal_ugx: number
          actual_roi_ugx: number
          amount_ugx: number
          authorized_on: string
          method: string
          evidence_reference: string
          verification_notes: string
          recorded_by: string
          recorded_at?: string
          request_id: string
          status?: string
          fulfilled_investment_id?: string | null
          fulfilled_by?: string | null
          fulfilled_at?: string | null
          revoked_by?: string | null
          revoked_at?: string | null
          revocation_reason?: string | null
        }
        Update: {
          target_maturity_date?: string
          target_return_bps?: number
          identity_verified?: boolean
          settlement_checked?: boolean
          agreement_accepted_offline?: boolean
          id?: string
          investment_id?: string
          legacy_partner_id?: string
          target_cycle_id?: string
          agreement_version_id?: string
          agreement_hash?: string
          principal_ugx?: number
          actual_roi_ugx?: number
          amount_ugx?: number
          authorized_on?: string
          method?: string
          evidence_reference?: string
          verification_notes?: string
          recorded_by?: string
          recorded_at?: string
          request_id?: string
          status?: string
          fulfilled_investment_id?: string | null
          fulfilled_by?: string | null
          fulfilled_at?: string | null
          revoked_by?: string | null
          revoked_at?: string | null
          revocation_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_reinvestment_authorizations_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: false
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_reinvestment_authorizations_legacy_partner_id_fkey"
            columns: ["legacy_partner_id"]
            isOneToOne: false
            referencedRelation: "legacy_partner_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_reinvestment_authorizations_target_cycle_id_fkey"
            columns: ["target_cycle_id"]
            isOneToOne: false
            referencedRelation: "investment_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_reinvestment_authorizations_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_reinvestment_authorizations_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_reinvestment_authorizations_fulfilled_by_fkey"
            columns: ["fulfilled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_reinvestment_authorizations_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_reinvestment_authorizations_fulfilled_investment_id_fkey"
            columns: ["fulfilled_investment_id"]
            isOneToOne: true
            referencedRelation: "investments"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_destinations: {
        Row: {
          account_last_four: string
          account_name: string
          account_ref_auth_tag: string
          account_ref_ciphertext: string
          account_ref_fingerprint: string
          account_ref_iv: string
          channel: Database["public"]["Enums"]["payout_channel"]
          created_at: string
          id: string
          investor_id: string
          is_active: boolean
          key_version: number
          provider_label: string
          updated_at: string
        }
        Insert: {
          account_last_four: string
          account_name: string
          account_ref_auth_tag: string
          account_ref_ciphertext: string
          account_ref_fingerprint: string
          account_ref_iv: string
          channel: Database["public"]["Enums"]["payout_channel"]
          created_at?: string
          id?: string
          investor_id: string
          is_active?: boolean
          key_version: number
          provider_label: string
          updated_at?: string
        }
        Update: {
          account_last_four?: string
          account_name?: string
          account_ref_auth_tag?: string
          account_ref_ciphertext?: string
          account_ref_fingerprint?: string
          account_ref_iv?: string
          channel?: Database["public"]["Enums"]["payout_channel"]
          created_at?: string
          id?: string
          investor_id?: string
          is_active?: boolean
          key_version?: number
          provider_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_destinations_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      primary_email_change_requests: {
        Row: {
          account_email_id: string | null
          confirmed_at: string | null
          expires_at: string | null
          finalized_at: string | null
          id: string
          mode: string
          new_email: string
          requested_at: string
          token_hash: string | null
          user_id: string
        }
        Insert: {
          account_email_id?: string | null
          confirmed_at?: string | null
          expires_at?: string | null
          finalized_at?: string | null
          id?: string
          mode: string
          new_email: string
          requested_at?: string
          token_hash?: string | null
          user_id: string
        }
        Update: {
          account_email_id?: string | null
          confirmed_at?: string | null
          expires_at?: string | null
          finalized_at?: string | null
          id?: string
          mode?: string
          new_email?: string
          requested_at?: string
          token_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "primary_email_change_requests_account_email_id_fkey"
            columns: ["account_email_id"]
            isOneToOne: false
            referencedRelation: "account_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "primary_email_change_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
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
          investment_limit_ugx: number | null
          is_test: boolean
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
          investment_limit_ugx?: number | null
          is_test?: boolean
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
          investment_limit_ugx?: number | null
          is_test?: boolean
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
      receipt_counters: {
        Row: {
          last_seq: number
          year: number
        }
        Insert: {
          last_seq?: number
          year: number
        }
        Update: {
          last_seq?: number
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_offline_reinvestment: {
        Args: {
          p_target_maturity_date: string
          p_target_return_bps: number
          p_identity_verified: boolean
          p_settlement_checked: boolean
          p_agreement_accepted: boolean
          p_admin_id: string
          p_admin_aal2: boolean
          p_request_id: string
          p_investment_id: string
          p_cycle_id: string
          p_agreement_hash: string
          p_amount: number
          p_authorized_on: string
          p_method: string
          p_evidence_reference: string
          p_verification_notes: string
        }
        Returns: string
      }
      complete_offline_reinvestment: {
        Args: {
          p_admin_id: string
          p_admin_aal2: boolean
          p_request_id: string
          p_authorization_id: string
          p_confirmation: string
        }
        Returns: string
      }
      revoke_offline_reinvestment: {
        Args: {
          p_admin_id: string
          p_admin_aal2: boolean
          p_request_id: string
          p_authorization_id: string
          p_reason: string
        }
        Returns: undefined
      }
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
      accept_standing_reinvest_terms: {
        Args: {
          p_agreement_version_id: string
          p_investor_id: string
          p_ip_fingerprint: string
          p_request_id: string
          p_user_agent: string
        }
        Returns: string
      }
      activate_investment: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_bank_reference: string
          p_confirmation: string
          p_investment_id: string
          p_received_amount_ugx: number
          p_received_at?: string
          p_received_date: string
          p_request_id: string
        }
        Returns: undefined
      }
      admin_revoke_standing_reinvest_authorization: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_investor_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      apply_september_partner_update: {
        Args: { p_admin_id: string; p_manifest: Json; p_request_id: string }
        Returns: Json
      }
      begin_maturity_instruction_processing: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_instruction_id: string
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
      confirm_maturity_amounts: {
        Args: {
          p_instruction_id: string
          p_investor_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      ensure_investment_receipt: {
        Args: { p_investment_id: string; p_investor_id: string }
        Returns: string
      }
      expire_investment: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_confirmation: string
          p_investment_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      fan_out_maturity_email: {
        Args: { p_action_url: string; p_job_id: string }
        Returns: number
      }
      fulfill_maturity_instruction: {
        Args: {
          p_actual_roi_ugx: number
          p_admin_aal2: boolean
          p_admin_id: string
          p_confirmation: string
          p_destination_verified: boolean
          p_instruction_id: string
          p_payout_reference: string
          p_request_id: string
        }
        Returns: Json
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
      mark_partner_portal_welcome_test_sent: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_provider_message_id: string
          p_request_id: string
        }
        Returns: string
      }
      maturity_payout_date: {
        Args: { p_maturity_date: string }
        Returns: string
      }
      newsletter_reading_report: { Args: { p_slugs: string[] }; Returns: Json }
      preview_cycle_actual_return: {
        Args: {
          p_actual_return_bps?: number
          p_admin_aal2: boolean
          p_admin_id: string
          p_cycle_id: string
        }
        Returns: Json
      }
      record_cycle_actual_return: {
        Args: {
          p_actual_return_bps: number
          p_admin_aal2: boolean
          p_admin_id: string
          p_confirmed: boolean
          p_cycle_id: string
          p_expected_investment_count: number
          p_expected_principal_ugx: number
          p_expected_revision: number
          p_request_id: string
        }
        Returns: Json
      }
      record_newsletter_visit: {
        Args: {
          p_event: string
          p_newsletter_slug: string
          p_partner_id: string
          p_visit_id: string
        }
        Returns: boolean
      }
      release_partner_portal_welcome_campaign: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_expected_count: number
          p_request_id: string
        }
        Returns: Json
      }
      reopen_maturity_instruction: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_instruction_id: string
          p_notes: string
          p_request_id: string
        }
        Returns: undefined
      }
      request_investment: {
        Args: {
          p_cycle_id: string
          p_expected_agreement_version_id?: string
          p_investor_id: string
          p_ip_fingerprint: string
          p_principal_ugx: number
          p_request_id: string
          p_user_agent: string
        }
        Returns: string
      }
      resolve_maturity_cc_review: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_job_id: string
          p_request_id: string
        }
        Returns: undefined
      }
      review_partner_application: {
        Args: {
          p_admin_id: string
          p_application_id: string
          p_decision: string
          p_notes: string | null
          p_reference: string
          p_user_id: string | null
        }
        Returns: undefined
      }
      revoke_standing_reinvest_authorization: {
        Args: { p_investor_id: string; p_request_id: string }
        Returns: undefined
      }
      run_maintenance: { Args: { p_request_id: string }; Returns: Json }
      save_admin_maturity_payout_destination: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_destination: Json
          p_expected_profile_updated_at: string | null
          p_instruction_id: string
          p_reference_source: string
          p_request_id: string
          p_verification_method: string
        }
        Returns: Json
      }
      set_partner_investment_limit: {
        Args: {
          p_admin_id: string
          p_investor_id: string
          p_limit_ugx: number | null
          p_reason: string
          p_request_id: string
        }
        Returns: undefined
      }
      stage_partner_import: {
        Args: { p_admin_id: string; p_manifest: Json; p_request_id: string }
        Returns: string
      }
      submit_maturity_instruction: {
        Args: {
          p_agreement_accepted: boolean
          p_choice: Database["public"]["Enums"]["maturity_choice"]
          p_custom_split?: boolean
          p_destination_confirmed: boolean
          p_expected_actual_return_bps?: number
          p_expected_agreement_version_id?: string
          p_expected_amount_basis?: string
          p_investment_id: string
          p_investor_id: string
          p_ip_fingerprint: string
          p_payout_destination_id: string
          p_request_id: string
          p_requested_withdrawal_ugx?: number
          p_target_cycle_id: string
          p_user_agent: string
        }
        Returns: string
      }
      submit_partner_application: {
        Args: { p_application: Json; p_identity: Json; p_token_hash: string }
        Returns: undefined
      }
      update_maturity_email_settings: {
        Args: {
          p_admin_aal2: boolean
          p_admin_id: string
          p_contacts: string[]
          p_enabled: boolean
          p_request_id: string
        }
        Returns: undefined
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
      job_kind:
        | "send_email"
        | "generate_agreement_pdf"
        | "revoke_sessions"
        | "generate_receipt_pdf"
      job_status: "pending" | "running" | "succeeded" | "failed" | "dead"
      maturity_choice:
        | "withdraw_all"
        | "withdraw_roi_reinvest_principal"
        | "reinvest_all"
      maturity_instruction_status: "requested" | "processing" | "fulfilled"
      payout_basis: "projected" | "reported_paid"
      payout_channel: "bank" | "mobile_money"
      receipt_source: "bank_activation" | "reinvestment" | "investment_record"
      receipt_status: "generating" | "ready" | "failed"
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
      job_kind: [
        "send_email",
        "generate_agreement_pdf",
        "revoke_sessions",
        "generate_receipt_pdf",
      ],
      job_status: ["pending", "running", "succeeded", "failed", "dead"],
      maturity_choice: [
        "withdraw_all",
        "withdraw_roi_reinvest_principal",
        "reinvest_all",
      ],
      maturity_instruction_status: ["requested", "processing", "fulfilled"],
      payout_basis: ["projected", "reported_paid"],
      payout_channel: ["bank", "mobile_money"],
      receipt_source: ["bank_activation", "reinvestment", "investment_record"],
      receipt_status: ["generating", "ready", "failed"],
      record_origin: ["portal", "legacy_import", "hybrid"],
      user_role: ["investor", "admin"],
    },
  },
} as const

