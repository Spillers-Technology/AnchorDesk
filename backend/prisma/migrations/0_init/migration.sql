-- AnchorDesk relational schema baseline as of 2.8.2.
-- This is a snapshot of schema.prisma, not a record of how the schema was built.
--
-- Ownership contract:
-- - prisma/migrations owns relational DDL derived from schema.prisma and applies it
--   once per version, in order, through Prisma's migration history.
-- - backend/src/db/pgExtras.ts solely owns PostgreSQL-only extensions, sequences,
--   functional, GIN, and partial indexes, CHECK constraints, functions, and
--   triggers that Prisma cannot express, and verifies its critical objects on
--   every boot.
-- - backend/src/db/dataMigrations.ts owns idempotent row-level repairs run at boot.
--
-- Do not append pgExtras-owned objects here. They are deliberately absent from
-- this migration and continue to be created and asserted by pgExtras.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('text', 'number', 'boolean', 'date', 'select');

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('ticket_created', 'ticket_updated', 'note_added', 'sla_at_risk', 'sla_breached');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'technician', 'readonly');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('local', 'oidc', 'saml');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('local', 'portal', 'connectwise', 'jira', 'imap', 'api');

-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('synced', 'pending', 'conflict', 'error');

-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('note', 'time_entry', 'email', 'internal');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'sync', 'export', 'merge', 'unmerge');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('connectwise', 'jira', 'imap', 'tactical_rmm', 'ninjaone', 'datto_rmm', 'meshcentral', 'netviz');

-- CreateEnum
CREATE TYPE "DeviceSource" AS ENUM ('local', 'netviz', 'tactical_rmm', 'ninjaone', 'datto_rmm', 'meshcentral', 'api');

-- CreateEnum
CREATE TYPE "ProbeStatus" AS ENUM ('online', 'offline', 'error');

-- CreateEnum
CREATE TYPE "ScriptJobStatus" AS ENUM ('queued', 'running', 'success', 'error', 'canceled');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('success', 'error', 'skipped');

-- CreateEnum
CREATE TYPE "SyncRunTrigger" AS ENUM ('manual', 'scheduled');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('running', 'success', 'degraded', 'error');

-- CreateEnum
CREATE TYPE "KbVisibility" AS ENUM ('internal', 'portal');

-- CreateEnum
CREATE TYPE "SessionScope" AS ENUM ('staff', 'portal');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('internal', 'public');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "auth_provider" "AuthProvider" NOT NULL DEFAULT 'local',
    "subject" VARCHAR(255),
    "username" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(255),
    "display_name" VARCHAR(150),
    "email" VARCHAR(255),
    "role" "UserRole" NOT NULL DEFAULT 'technician',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret" VARCHAR(64),
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_recovery" JSONB,
    "signature_html" TEXT,
    "theme_pref" VARCHAR(40),
    "kanban_columns" JSONB,
    "last_seen_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "prefix" VARCHAR(20) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" SERIAL NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "client_name" VARCHAR(255),
    "redirect_uris" JSONB NOT NULL,
    "grant_types" JSONB NOT NULL,
    "scope" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_auth_codes" (
    "id" SERIAL NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "redirect_uri" VARCHAR(2000) NOT NULL,
    "code_challenge" VARCHAR(255) NOT NULL,
    "scope" VARCHAR(500),
    "resource" VARCHAR(2000),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "scope" "SessionScope" NOT NULL DEFAULT 'staff',
    "user_id" INTEGER,
    "contact_id" INTEGER,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(255),
    "ip" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "local_enabled" BOOLEAN NOT NULL DEFAULT true,
    "oidc_enabled" BOOLEAN NOT NULL DEFAULT false,
    "oidc_issuer_url" VARCHAR(500),
    "oidc_client_id" VARCHAR(255),
    "oidc_client_secret" VARCHAR(500),
    "oidc_redirect_uri" VARCHAR(500),
    "saml_enabled" BOOLEAN NOT NULL DEFAULT false,
    "saml_entry_point" VARCHAR(500),
    "saml_issuer" VARCHAR(255),
    "saml_idp_cert" TEXT,
    "mfa_required" BOOLEAN NOT NULL DEFAULT true,
    "mfa_issuer" VARCHAR(100),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "host" VARCHAR(255) NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" VARCHAR(255) NOT NULL,
    "password_enc" TEXT,
    "folder" VARCHAR(100) NOT NULL DEFAULT 'INBOX',
    "company_name" VARCHAR(150),
    "label_id" INTEGER,
    "identity_id" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_uid" INTEGER,
    "last_polled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "domain" VARCHAR(150),
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "website" VARCHAR(255),
    "address" VARCHAR(500),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "title" VARCHAR(150),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "ticket_number" VARCHAR(50),
    "title" VARCHAR(255) NOT NULL,
    "summary" VARCHAR(500),
    "description" TEXT,
    "status" VARCHAR(100) NOT NULL DEFAULT 'New',
    "priority" VARCHAR(50),
    "company_name" VARCHAR(150),
    "company_id" INTEGER,
    "contact_id" INTEGER,
    "assignee" VARCHAR(100),
    "assignee_id" INTEGER,
    "team_id" INTEGER,
    "custom_fields" JSONB,
    "source" "TicketSource" NOT NULL DEFAULT 'local',
    "external_id" VARCHAR(255),
    "external_provider" VARCHAR(50),
    "sync_state" "SyncState",
    "synced_at" TIMESTAMP(3),
    "remote_hash" VARCHAR(64),
    "remote_updated_at" TIMESTAMP(3),
    "sync_revision" INTEGER NOT NULL DEFAULT 0,
    "sync_connection_id" INTEGER,
    "sla_policy_id" INTEGER,
    "response_due_at" TIMESTAMP(3),
    "resolution_due_at" TIMESTAMP(3),
    "first_responded_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "portal_access_revoked_at" TIMESTAMP(3),
    "parent_id" INTEGER,
    "merged_into_id" INTEGER,
    "merged_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_merges" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "target_id" INTEGER NOT NULL,
    "actor" VARCHAR(255) NOT NULL,
    "merged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unmerged_at" TIMESTAMP(3),
    "undo_plan" JSONB NOT NULL,

    CONSTRAINT "ticket_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "author" VARCHAR(150) NOT NULL,
    "author_id" INTEGER,
    "note_type" "NoteType" NOT NULL DEFAULT 'note',
    "time_start" TIMESTAMP(3),
    "time_stop" TIMESTAMP(3),
    "worked_at" TIMESTAMP(3),
    "minutes" INTEGER,
    "external_id" VARCHAR(255),
    "sync_pending" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'internal',
    "via" VARCHAR(20),
    "origin_ticket_id" INTEGER,
    "direction" VARCHAR(10),
    "html_content" TEXT,
    "email_from" VARCHAR(320),
    "email_to" TEXT,
    "email_cc" TEXT,
    "email_bcc" TEXT,
    "subject" VARCHAR(255),
    "in_reply_to" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "note_id" INTEGER,
    "filename" VARCHAR(500) NOT NULL,
    "content_type" VARCHAR(150) NOT NULL DEFAULT 'application/octet-stream',
    "size" INTEGER NOT NULL DEFAULT 0,
    "storage_backend" VARCHAR(20) NOT NULL DEFAULT 'local',
    "storage_key" VARCHAR(500) NOT NULL,
    "created_by" VARCHAR(255),
    "portal_visible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "ticket_id" INTEGER,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "priority" VARCHAR(50),
    "company_id" INTEGER,
    "response_minutes" INTEGER NOT NULL,
    "resolution_minutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_identities" (
    "id" SERIAL NOT NULL,
    "address" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(150),
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "user_id" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_templates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "subject" VARCHAR(255),
    "body_html" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(150),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_items" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "due_offset_minutes" INTEGER,

    CONSTRAINT "checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_by" VARCHAR(150),
    "done_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "template_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "color" VARCHAR(20) NOT NULL DEFAULT '#6750A4',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_labels" (
    "ticket_id" INTEGER NOT NULL,
    "label_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_labels_pkey" PRIMARY KEY ("ticket_id","label_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "changed_by" VARCHAR(255),
    "old_value" JSONB,
    "new_value" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "ProviderType" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_revision" INTEGER NOT NULL DEFAULT 1,
    "last_test_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_providers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "ProviderType" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "config_revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connection_id" INTEGER,

    CONSTRAINT "sync_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "config_revision" INTEGER NOT NULL,
    "lock_protocol" INTEGER NOT NULL DEFAULT 0,
    "trigger" "SyncRunTrigger" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'running',
    "initiated_by" VARCHAR(255),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "tickets_created" INTEGER NOT NULL DEFAULT 0,
    "tickets_updated" INTEGER NOT NULL DEFAULT 0,
    "notes_upserted" INTEGER NOT NULL DEFAULT 0,
    "tickets_filtered" INTEGER NOT NULL DEFAULT 0,
    "tickets_skipped" INTEGER NOT NULL DEFAULT 0,
    "tickets_conflicted" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "latest_error" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_account_claims" (
    "account_key" VARCHAR(255) NOT NULL,
    "owner_token" UUID NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_account_claims_pkey" PRIMARY KEY ("account_key")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "id" BIGSERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "run_id" INTEGER,
    "external_id" VARCHAR(255),
    "internal_id" INTEGER,
    "direction" "SyncDirection" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "message" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "hostname" VARCHAR(255),
    "display_name" VARCHAR(255),
    "ip_address" VARCHAR(45),
    "mac_address" VARCHAR(17),
    "vendor" VARCHAR(150),
    "asset_tag" VARCHAR(100),
    "serial_number" VARCHAR(150),
    "manufacturer" VARCHAR(150),
    "model" VARCHAR(150),
    "location" VARCHAR(255),
    "purchase_date" DATE,
    "warranty_expires_at" DATE,
    "notes" TEXT,
    "os" VARCHAR(150),
    "device_type" VARCHAR(100),
    "open_ports" JSONB,
    "status" VARCHAR(50) NOT NULL DEFAULT 'unknown',
    "company_name" VARCHAR(150),
    "company_id" INTEGER,
    "source" "DeviceSource" NOT NULL DEFAULT 'local',
    "probe_id" INTEGER,
    "external_id" VARCHAR(255),
    "external_provider" VARCHAR(50),
    "metadata" JSONB,
    "first_seen_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_external_refs" (
    "id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "metadata" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "script_jobs" (
    "id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "ticket_id" INTEGER,
    "runner" VARCHAR(50) NOT NULL,
    "external_device_id" VARCHAR(255),
    "script_ref" VARCHAR(150) NOT NULL,
    "script_name" VARCHAR(255),
    "args" JSONB,
    "timeout_seconds" INTEGER,
    "invocation_id" VARCHAR(512),
    "status" "ScriptJobStatus" NOT NULL DEFAULT 'queued',
    "output" TEXT,
    "exit_code" INTEGER,
    "scheduled_for" TIMESTAMP(3),
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "script_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_links" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "device_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "probes" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "api_key" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(50) NOT NULL DEFAULT 'netviz',
    "company_name" VARCHAR(150),
    "company_id" INTEGER,
    "cidr" VARCHAR(100),
    "version" VARCHAR(50),
    "status" "ProbeStatus" NOT NULL DEFAULT 'offline',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "probes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "custom_field_defs" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "AutomationTrigger" NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "filters" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "from_value" VARCHAR(100),
    "to_value" VARCHAR(100),
    "actor" VARCHAR(255),
    "company_id" INTEGER,
    "team_id" INTEGER,
    "assignee_id" INTEGER,
    "priority" VARCHAR(50),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_audit_id" BIGINT,
    "source_key" VARCHAR(255),

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_sla_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "policy_id" INTEGER,
    "policy_name" VARCHAR(150),
    "response_minutes" INTEGER,
    "resolution_minutes" INTEGER,
    "response_due_at" TIMESTAMP(3),
    "resolution_due_at" TIMESTAMP(3),
    "established_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_sla_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body_html" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "visibility" "KbVisibility" NOT NULL DEFAULT 'internal',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "author" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_magic_links" (
    "id" SERIAL NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "selector_hash" VARCHAR(64) NOT NULL,
    "verifier_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_registrations" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "company_id" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reviewed_by" VARCHAR(255),
    "reviewed_at" TIMESTAMP(3),
    "contact_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_grants" (
    "id" SERIAL NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "granted_by" VARCHAR(255) NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "revoked_by" VARCHAR(255),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "portal_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_portal_profiles" (
    "user_id" INTEGER NOT NULL,
    "display_name" VARCHAR(150),
    "avatar_storage_key" VARCHAR(500),
    "avatar_content_type" VARCHAR(150),
    "avatar_storage_backend" VARCHAR(20),
    "public_email" VARCHAR(255),
    "public_phone" VARCHAR(50),
    "opted_in" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_portal_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ticket_feedback" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "rating" VARCHAR(10) NOT NULL,
    "comment" TEXT,
    "contact_id" INTEGER NOT NULL,
    "company_id" INTEGER,
    "team_id" INTEGER,
    "assignee_id" INTEGER,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_subject_key" ON "users"("auth_provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_auth_codes_code_hash_key" ON "oauth_auth_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_auth_codes_expires_at_idx" ON "oauth_auth_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_contact_id_idx" ON "sessions"("contact_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "tickets_sync_connection_id_idx" ON "tickets"("sync_connection_id");

-- CreateIndex
CREATE INDEX "tickets_company_id_idx" ON "tickets"("company_id");

-- CreateIndex
CREATE INDEX "tickets_team_id_idx" ON "tickets"("team_id");

-- CreateIndex
CREATE INDEX "tickets_response_due_at_idx" ON "tickets"("response_due_at");

-- CreateIndex
CREATE INDEX "tickets_resolution_due_at_idx" ON "tickets"("resolution_due_at");

-- CreateIndex
CREATE INDEX "tickets_due_at_idx" ON "tickets"("due_at");

-- CreateIndex
CREATE INDEX "tickets_portal_access_revoked_at_idx" ON "tickets"("portal_access_revoked_at");

-- CreateIndex
CREATE INDEX "tickets_parent_id_idx" ON "tickets"("parent_id");

-- CreateIndex
CREATE INDEX "tickets_merged_into_id_idx" ON "tickets"("merged_into_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_external_id_external_provider_sync_connection_id_key" ON "tickets"("external_id", "external_provider", "sync_connection_id");

-- CreateIndex
CREATE INDEX "ticket_merges_source_id_unmerged_at_idx" ON "ticket_merges"("source_id", "unmerged_at");

-- CreateIndex
CREATE INDEX "ticket_merges_target_id_merged_at_idx" ON "ticket_merges"("target_id", "merged_at");

-- CreateIndex
CREATE INDEX "attachments_ticket_id_idx" ON "attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "attachments_note_id_idx" ON "attachments"("note_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "sla_policies_company_id_idx" ON "sla_policies"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_identities_address_key" ON "mail_identities"("address");

-- CreateIndex
CREATE INDEX "mail_identities_user_id_idx" ON "mail_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_name_key" ON "checklist_templates"("name");

-- CreateIndex
CREATE INDEX "checklist_template_items_template_id_idx" ON "checklist_template_items"("template_id");

-- CreateIndex
CREATE INDEX "checklist_items_ticket_id_idx" ON "checklist_items"("ticket_id");

-- CreateIndex
CREATE INDEX "checklist_items_due_at_idx" ON "checklist_items"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "labels_name_key" ON "labels"("name");

-- CreateIndex
CREATE INDEX "ticket_labels_label_id_idx" ON "ticket_labels"("label_id");

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_time" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "connections_name_key" ON "connections"("name");

-- CreateIndex
CREATE INDEX "connections_type_idx" ON "connections"("type");

-- CreateIndex
CREATE UNIQUE INDEX "sync_providers_name_key" ON "sync_providers"("name");

-- CreateIndex
CREATE INDEX "sync_providers_connection_id_idx" ON "sync_providers"("connection_id");

-- CreateIndex
CREATE INDEX "idx_sync_run_provider" ON "sync_runs"("provider_id", "started_at");

-- CreateIndex
CREATE INDEX "idx_sync_run_status" ON "sync_runs"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_account_claims_owner_token_key" ON "sync_account_claims"("owner_token");

-- CreateIndex
CREATE INDEX "sync_account_claims_claimed_at_idx" ON "sync_account_claims"("claimed_at");

-- CreateIndex
CREATE INDEX "idx_sync_provider" ON "sync_log"("provider_id", "synced_at");

-- CreateIndex
CREATE INDEX "idx_sync_run_log" ON "sync_log"("run_id", "synced_at");

-- CreateIndex
CREATE INDEX "devices_company_name_idx" ON "devices"("company_name");

-- CreateIndex
CREATE UNIQUE INDEX "devices_external_id_external_provider_key" ON "devices"("external_id", "external_provider");

-- CreateIndex
CREATE INDEX "device_external_refs_device_id_idx" ON "device_external_refs"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_external_refs_provider_external_id_key" ON "device_external_refs"("provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_external_refs_device_id_provider_key" ON "device_external_refs"("device_id", "provider");

-- CreateIndex
CREATE INDEX "script_jobs_device_id_idx" ON "script_jobs"("device_id");

-- CreateIndex
CREATE INDEX "script_jobs_status_scheduled_for_idx" ON "script_jobs"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "device_links_ticket_id_device_id_key" ON "device_links"("ticket_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "probes_api_key_key" ON "probes"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_defs_key_key" ON "custom_field_defs"("key");

-- CreateIndex
CREATE INDEX "saved_views_user_id_idx" ON "saved_views"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_events_source_key_key" ON "ticket_events"("source_key");

-- CreateIndex
CREATE INDEX "idx_ticket_events_occurred" ON "ticket_events"("occurred_at");

-- CreateIndex
CREATE INDEX "idx_ticket_events_ticket_occurred" ON "ticket_events"("ticket_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_ticket_events_kind_occurred" ON "ticket_events"("kind", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_ticket_events_company_occurred" ON "ticket_events"("company_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_events_source_audit_kind_key" ON "ticket_events"("source_audit_id", "kind");

-- CreateIndex
CREATE INDEX "idx_ticket_sla_snapshots_ticket_established" ON "ticket_sla_snapshots"("ticket_id", "established_at");

-- CreateIndex
CREATE INDEX "idx_ticket_sla_snapshots_response_due" ON "ticket_sla_snapshots"("response_due_at");

-- CreateIndex
CREATE INDEX "idx_ticket_sla_snapshots_resolution_due" ON "ticket_sla_snapshots"("resolution_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "kb_articles_slug_key" ON "kb_articles"("slug");

-- CreateIndex
CREATE INDEX "kb_articles_deleted_at_visibility_published_idx" ON "kb_articles"("deleted_at", "visibility", "published");

-- CreateIndex
CREATE INDEX "kb_articles_category_idx" ON "kb_articles"("category");

-- CreateIndex
CREATE UNIQUE INDEX "portal_magic_links_selector_hash_key" ON "portal_magic_links"("selector_hash");

-- CreateIndex
CREATE INDEX "portal_magic_links_contact_id_created_at_idx" ON "portal_magic_links"("contact_id", "created_at");

-- CreateIndex
CREATE INDEX "portal_magic_links_expires_at_idx" ON "portal_magic_links"("expires_at");

-- CreateIndex
CREATE INDEX "portal_registrations_status_created_at_idx" ON "portal_registrations"("status", "created_at");

-- CreateIndex
CREATE INDEX "portal_registrations_email_idx" ON "portal_registrations"("email");

-- CreateIndex
CREATE INDEX "portal_grants_contact_id_revoked_at_idx" ON "portal_grants"("contact_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ticket_feedback_ticket_id_submitted_at_idx" ON "ticket_feedback"("ticket_id", "submitted_at");

-- CreateIndex
CREATE INDEX "ticket_feedback_company_id_submitted_at_idx" ON "ticket_feedback"("company_id", "submitted_at");

-- CreateIndex
CREATE INDEX "ticket_feedback_assignee_id_submitted_at_idx" ON "ticket_feedback"("assignee_id", "submitted_at");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_merges" ADD CONSTRAINT "ticket_merges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_merges" ADD CONSTRAINT "ticket_merges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_identities" ADD CONSTRAINT "mail_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_providers" ADD CONSTRAINT "sync_providers_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sync_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "sync_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_internal_id_fkey" FOREIGN KEY ("internal_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_probe_id_fkey" FOREIGN KEY ("probe_id") REFERENCES "probes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_external_refs" ADD CONSTRAINT "device_external_refs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script_jobs" ADD CONSTRAINT "script_jobs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script_jobs" ADD CONSTRAINT "script_jobs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_links" ADD CONSTRAINT "device_links_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_links" ADD CONSTRAINT "device_links_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "probes" ADD CONSTRAINT "probes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_magic_links" ADD CONSTRAINT "portal_magic_links_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_registrations" ADD CONSTRAINT "portal_registrations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_registrations" ADD CONSTRAINT "portal_registrations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_grants" ADD CONSTRAINT "portal_grants_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_portal_profiles" ADD CONSTRAINT "user_portal_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_feedback" ADD CONSTRAINT "ticket_feedback_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_feedback" ADD CONSTRAINT "ticket_feedback_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
