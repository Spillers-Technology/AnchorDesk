--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: AuditAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuditAction" AS ENUM (
    'create',
    'update',
    'delete',
    'sync',
    'export',
    'merge',
    'unmerge'
);


--
-- Name: AuthProvider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuthProvider" AS ENUM (
    'local',
    'oidc',
    'saml'
);


--
-- Name: AutomationTrigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AutomationTrigger" AS ENUM (
    'ticket_created',
    'ticket_updated',
    'note_added',
    'sla_at_risk',
    'sla_breached'
);


--
-- Name: CustomFieldType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CustomFieldType" AS ENUM (
    'text',
    'number',
    'boolean',
    'date',
    'select'
);


--
-- Name: DeviceSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DeviceSource" AS ENUM (
    'local',
    'netviz',
    'tactical_rmm',
    'ninjaone',
    'datto_rmm',
    'meshcentral',
    'api'
);


--
-- Name: KbVisibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."KbVisibility" AS ENUM (
    'internal',
    'portal'
);


--
-- Name: NoteType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NoteType" AS ENUM (
    'note',
    'time_entry',
    'email',
    'internal'
);


--
-- Name: NoteVisibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NoteVisibility" AS ENUM (
    'internal',
    'public'
);


--
-- Name: ProbeStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProbeStatus" AS ENUM (
    'online',
    'offline',
    'error'
);


--
-- Name: ProviderType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProviderType" AS ENUM (
    'connectwise',
    'jira',
    'imap',
    'tactical_rmm',
    'ninjaone',
    'datto_rmm',
    'meshcentral',
    'netviz'
);


--
-- Name: ScriptJobStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ScriptJobStatus" AS ENUM (
    'queued',
    'running',
    'success',
    'error',
    'canceled'
);


--
-- Name: SessionScope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SessionScope" AS ENUM (
    'staff',
    'portal'
);


--
-- Name: SyncDirection; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncDirection" AS ENUM (
    'inbound',
    'outbound'
);


--
-- Name: SyncRunStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncRunStatus" AS ENUM (
    'running',
    'success',
    'degraded',
    'error'
);


--
-- Name: SyncRunTrigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncRunTrigger" AS ENUM (
    'manual',
    'scheduled'
);


--
-- Name: SyncState; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncState" AS ENUM (
    'synced',
    'pending',
    'conflict',
    'error'
);


--
-- Name: SyncStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncStatus" AS ENUM (
    'success',
    'error',
    'skipped'
);


--
-- Name: TicketSource; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TicketSource" AS ENUM (
    'local',
    'portal',
    'connectwise',
    'jira',
    'imap',
    'api'
);


--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserRole" AS ENUM (
    'admin',
    'technician',
    'readonly'
);


--
-- Name: anchordesk_assert_single_level_hierarchy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anchordesk_assert_single_level_hierarchy() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.parent_id IS NOT NULL THEN
        IF NEW.parent_id = NEW.id THEN
          RAISE EXCEPTION 'ticket % cannot be its own parent', NEW.id
            USING ERRCODE = 'check_violation';
        END IF;
        -- Lock the prospective parent before inspecting it. Without this the
        -- EXISTS checks below read a snapshot, and two concurrent transactions
        -- doing "A.parent := B" and "B.parent := A" each see the other's row as
        -- still parentless and both commit -- producing the depth-2 cycle this
        -- trigger exists to prevent. Each transaction already holds the row lock
        -- on the ticket it is updating, so taking the parent's lock here makes
        -- the pair either serialize or deadlock, and Postgres aborts one.
        PERFORM 1 FROM tickets WHERE id = NEW.parent_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM tickets WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
          RAISE EXCEPTION 'ticket % is already a child; AnchorDesk supports one level of hierarchy', NEW.parent_id
            USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM tickets WHERE parent_id = NEW.id) THEN
          RAISE EXCEPTION 'ticket % has children, so it cannot also become a child', NEW.id
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: anchordesk_reject_reporting_fact_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anchordesk_reject_reporting_fact_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'check_violation';
    END;
    $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name character varying(150) NOT NULL,
    token_hash character varying(64) NOT NULL,
    prefix character varying(20) NOT NULL,
    last_used_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone,
    revoked_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: api_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_tokens_id_seq OWNED BY public.api_tokens.id;


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    note_id integer,
    filename character varying(500) NOT NULL,
    content_type character varying(150) DEFAULT 'application/octet-stream'::character varying NOT NULL,
    size integer DEFAULT 0 NOT NULL,
    storage_backend character varying(20) DEFAULT 'local'::character varying NOT NULL,
    storage_key character varying(500) NOT NULL,
    created_by character varying(255),
    portal_visible boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attachments_id_seq OWNED BY public.attachments.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id integer NOT NULL,
    action public."AuditAction" NOT NULL,
    changed_by character varying(255),
    old_value jsonb,
    new_value jsonb,
    occurred_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: auth_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_settings (
    id integer DEFAULT 1 NOT NULL,
    local_enabled boolean DEFAULT true NOT NULL,
    oidc_enabled boolean DEFAULT false NOT NULL,
    oidc_issuer_url character varying(500),
    oidc_client_id character varying(255),
    oidc_client_secret character varying(500),
    oidc_redirect_uri character varying(500),
    saml_enabled boolean DEFAULT false NOT NULL,
    saml_entry_point character varying(500),
    saml_issuer character varying(255),
    saml_idp_cert text,
    mfa_required boolean DEFAULT true NOT NULL,
    mfa_issuer character varying(100),
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_rules (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    trigger public."AutomationTrigger" NOT NULL,
    conditions jsonb NOT NULL,
    actions jsonb NOT NULL,
    run_count integer DEFAULT 0 NOT NULL,
    last_run_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: automation_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_rules_id_seq OWNED BY public.automation_rules.id;


--
-- Name: checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_items (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    text character varying(500) NOT NULL,
    done boolean DEFAULT false NOT NULL,
    done_by character varying(150),
    done_at timestamp(3) without time zone,
    due_at timestamp(3) without time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    template_id integer,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: checklist_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.checklist_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: checklist_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.checklist_items_id_seq OWNED BY public.checklist_items.id;


--
-- Name: checklist_template_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_template_items (
    id integer NOT NULL,
    template_id integer NOT NULL,
    text character varying(500) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    due_offset_minutes integer
);


--
-- Name: checklist_template_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.checklist_template_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: checklist_template_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.checklist_template_items_id_seq OWNED BY public.checklist_template_items.id;


--
-- Name: checklist_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_templates (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    description character varying(500),
    active boolean DEFAULT true NOT NULL,
    created_by character varying(150),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: checklist_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.checklist_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: checklist_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.checklist_templates_id_seq OWNED BY public.checklist_templates.id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    domain character varying(150),
    phone character varying(50),
    email character varying(255),
    website character varying(255),
    address character varying(500),
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connections (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    type public."ProviderType" NOT NULL,
    config jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config_revision integer DEFAULT 1 NOT NULL,
    last_test_at timestamp(3) without time zone,
    last_test_ok boolean,
    last_test_message text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.connections_id_seq OWNED BY public.connections.id;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id integer NOT NULL,
    company_id integer NOT NULL,
    name character varying(200) NOT NULL,
    email character varying(255),
    phone character varying(50),
    title character varying(150),
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacts_id_seq OWNED BY public.contacts.id;


--
-- Name: custom_field_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_field_defs (
    id integer NOT NULL,
    key character varying(60) NOT NULL,
    label character varying(100) NOT NULL,
    type public."CustomFieldType" NOT NULL,
    options jsonb,
    required boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: custom_field_defs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.custom_field_defs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: custom_field_defs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.custom_field_defs_id_seq OWNED BY public.custom_field_defs.id;


--
-- Name: device_external_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_external_refs (
    id integer NOT NULL,
    device_id integer NOT NULL,
    provider character varying(50) NOT NULL,
    external_id character varying(255) NOT NULL,
    metadata jsonb,
    first_seen_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: device_external_refs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_external_refs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_external_refs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_external_refs_id_seq OWNED BY public.device_external_refs.id;


--
-- Name: device_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_links (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    device_id integer NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: device_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_links_id_seq OWNED BY public.device_links.id;


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id integer NOT NULL,
    hostname character varying(255),
    display_name character varying(255),
    ip_address character varying(45),
    mac_address character varying(17),
    vendor character varying(150),
    asset_tag character varying(100),
    serial_number character varying(150),
    manufacturer character varying(150),
    model character varying(150),
    location character varying(255),
    purchase_date date,
    warranty_expires_at date,
    notes text,
    os character varying(150),
    device_type character varying(100),
    open_ports jsonb,
    status character varying(50) DEFAULT 'unknown'::character varying NOT NULL,
    company_name character varying(150),
    company_id integer,
    source public."DeviceSource" DEFAULT 'local'::public."DeviceSource" NOT NULL,
    probe_id integer,
    external_id character varying(255),
    external_provider character varying(50),
    metadata jsonb,
    first_seen_at timestamp(3) without time zone,
    last_seen_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.devices_id_seq OWNED BY public.devices.id;


--
-- Name: kb_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_articles (
    id integer NOT NULL,
    slug character varying(200) NOT NULL,
    title character varying(255) NOT NULL,
    body_html text NOT NULL,
    body_text text NOT NULL,
    category character varying(100) NOT NULL,
    visibility public."KbVisibility" DEFAULT 'internal'::public."KbVisibility" NOT NULL,
    published boolean DEFAULT false NOT NULL,
    author character varying(255) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone
);


--
-- Name: kb_articles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kb_articles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kb_articles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kb_articles_id_seq OWNED BY public.kb_articles.id;


--
-- Name: labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labels (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    color character varying(20) DEFAULT '#6750A4'::character varying NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: labels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.labels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: labels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.labels_id_seq OWNED BY public.labels.id;


--
-- Name: mail_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_identities (
    id integer NOT NULL,
    address character varying(320) NOT NULL,
    display_name character varying(150),
    shared boolean DEFAULT true NOT NULL,
    user_id integer,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: mail_identities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mail_identities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mail_identities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mail_identities_id_seq OWNED BY public.mail_identities.id;


--
-- Name: mail_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_templates (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    subject character varying(255),
    body_html text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: mail_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mail_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mail_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mail_templates_id_seq OWNED BY public.mail_templates.id;


--
-- Name: mailboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mailboxes (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    host character varying(255) NOT NULL,
    port integer DEFAULT 993 NOT NULL,
    secure boolean DEFAULT true NOT NULL,
    username character varying(255) NOT NULL,
    password_enc text,
    folder character varying(100) DEFAULT 'INBOX'::character varying NOT NULL,
    company_name character varying(150),
    label_id integer,
    identity_id integer,
    enabled boolean DEFAULT true NOT NULL,
    last_uid integer,
    last_polled_at timestamp(3) without time zone,
    last_error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: mailboxes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mailboxes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mailboxes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mailboxes_id_seq OWNED BY public.mailboxes.id;


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    content text NOT NULL,
    author character varying(150) NOT NULL,
    author_id integer,
    note_type public."NoteType" DEFAULT 'note'::public."NoteType" NOT NULL,
    time_start timestamp(3) without time zone,
    time_stop timestamp(3) without time zone,
    worked_at timestamp(3) without time zone,
    minutes integer,
    external_id character varying(255),
    sync_pending boolean DEFAULT false NOT NULL,
    visibility public."NoteVisibility" DEFAULT 'internal'::public."NoteVisibility" NOT NULL,
    via character varying(20),
    origin_ticket_id integer,
    direction character varying(10),
    html_content text,
    email_from character varying(320),
    email_to text,
    email_cc text,
    email_bcc text,
    subject character varying(255),
    in_reply_to character varying(255),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notes_id_seq OWNED BY public.notes.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type character varying(50) NOT NULL,
    ticket_id integer,
    title character varying(255) NOT NULL,
    body text,
    read_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: oauth_auth_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_auth_codes (
    id integer NOT NULL,
    code_hash character varying(64) NOT NULL,
    client_id character varying(64) NOT NULL,
    user_id integer NOT NULL,
    redirect_uri character varying(2000) NOT NULL,
    code_challenge character varying(255) NOT NULL,
    scope character varying(500),
    resource character varying(2000),
    expires_at timestamp(3) without time zone NOT NULL,
    used_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: oauth_auth_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oauth_auth_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oauth_auth_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oauth_auth_codes_id_seq OWNED BY public.oauth_auth_codes.id;


--
-- Name: oauth_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_clients (
    id integer NOT NULL,
    client_id character varying(64) NOT NULL,
    client_name character varying(255),
    redirect_uris jsonb NOT NULL,
    grant_types jsonb NOT NULL,
    scope character varying(500),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: oauth_clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oauth_clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oauth_clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oauth_clients_id_seq OWNED BY public.oauth_clients.id;


--
-- Name: portal_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_grants (
    id integer NOT NULL,
    contact_id integer NOT NULL,
    company_id integer NOT NULL,
    granted_by character varying(255) NOT NULL,
    granted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    effective_from timestamp(3) without time zone NOT NULL,
    revoked_by character varying(255),
    revoked_at timestamp(3) without time zone
);


--
-- Name: portal_grants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_grants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_grants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_grants_id_seq OWNED BY public.portal_grants.id;


--
-- Name: portal_magic_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_magic_links (
    id integer NOT NULL,
    contact_id integer NOT NULL,
    selector_hash character varying(64) NOT NULL,
    verifier_hash character varying(64) NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    used_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: portal_magic_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_magic_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_magic_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_magic_links_id_seq OWNED BY public.portal_magic_links.id;


--
-- Name: portal_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_registrations (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    company_id integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by character varying(255),
    reviewed_at timestamp(3) without time zone,
    contact_id integer,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: portal_registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_registrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_registrations_id_seq OWNED BY public.portal_registrations.id;


--
-- Name: probes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.probes (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    api_key character varying(100) NOT NULL,
    kind character varying(50) DEFAULT 'netviz'::character varying NOT NULL,
    company_name character varying(150),
    company_id integer,
    cidr character varying(100),
    version character varying(50),
    status public."ProbeStatus" DEFAULT 'offline'::public."ProbeStatus" NOT NULL,
    last_seen_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: probes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.probes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: probes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.probes_id_seq OWNED BY public.probes.id;


--
-- Name: saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_views (
    id integer NOT NULL,
    user_id integer,
    name character varying(100) NOT NULL,
    filters jsonb NOT NULL,
    shared boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: saved_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.saved_views_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: saved_views_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.saved_views_id_seq OWNED BY public.saved_views.id;


--
-- Name: script_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.script_jobs (
    id integer NOT NULL,
    device_id integer NOT NULL,
    ticket_id integer,
    runner character varying(50) NOT NULL,
    external_device_id character varying(255),
    script_ref character varying(150) NOT NULL,
    script_name character varying(255),
    args jsonb,
    timeout_seconds integer,
    invocation_id character varying(512),
    status public."ScriptJobStatus" DEFAULT 'queued'::public."ScriptJobStatus" NOT NULL,
    output text,
    exit_code integer,
    scheduled_for timestamp(3) without time zone,
    created_by character varying(255),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    started_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone
);


--
-- Name: script_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.script_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: script_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.script_jobs_id_seq OWNED BY public.script_jobs.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    scope public."SessionScope" DEFAULT 'staff'::public."SessionScope" NOT NULL,
    user_id integer,
    contact_id integer,
    token_hash character varying(64) NOT NULL,
    user_agent character varying(255),
    ip character varying(45),
    expires_at timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT sessions_scope_principal_check CHECK ((((scope = 'staff'::public."SessionScope") AND (user_id IS NOT NULL) AND (contact_id IS NULL)) OR ((scope = 'portal'::public."SessionScope") AND (user_id IS NULL) AND (contact_id IS NOT NULL))))
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key character varying(100) NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: sla_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_policies (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    priority character varying(50),
    company_id integer,
    response_minutes integer NOT NULL,
    resolution_minutes integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: sla_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sla_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sla_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sla_policies_id_seq OWNED BY public.sla_policies.id;


--
-- Name: sync_account_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_account_claims (
    account_key character varying(255) NOT NULL,
    owner_token uuid NOT NULL,
    claimed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_log (
    id bigint NOT NULL,
    provider_id integer NOT NULL,
    run_id integer,
    external_id character varying(255),
    internal_id integer,
    direction public."SyncDirection" NOT NULL,
    status public."SyncStatus" NOT NULL,
    message text,
    synced_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_log_id_seq OWNED BY public.sync_log.id;


--
-- Name: sync_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_providers (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    type public."ProviderType" NOT NULL,
    config jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_synced_at timestamp(3) without time zone,
    config_revision integer DEFAULT 1 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    connection_id integer
);


--
-- Name: sync_providers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_providers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_providers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_providers_id_seq OWNED BY public.sync_providers.id;


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    id integer NOT NULL,
    provider_id integer NOT NULL,
    config_revision integer NOT NULL,
    lock_protocol integer DEFAULT 0 NOT NULL,
    trigger public."SyncRunTrigger" NOT NULL,
    status public."SyncRunStatus" DEFAULT 'running'::public."SyncRunStatus" NOT NULL,
    initiated_by character varying(255),
    started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(3) without time zone,
    duration_ms integer,
    tickets_created integer DEFAULT 0 NOT NULL,
    tickets_updated integer DEFAULT 0 NOT NULL,
    notes_upserted integer DEFAULT 0 NOT NULL,
    tickets_filtered integer DEFAULT 0 NOT NULL,
    tickets_skipped integer DEFAULT 0 NOT NULL,
    tickets_conflicted integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    latest_error text
);


--
-- Name: sync_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_runs_id_seq OWNED BY public.sync_runs.id;


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    team_id integer NOT NULL,
    user_id integer NOT NULL
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(300),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: ticket_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_events (
    id bigint NOT NULL,
    ticket_id integer NOT NULL,
    kind character varying(40) NOT NULL,
    from_value character varying(100),
    to_value character varying(100),
    actor character varying(255),
    company_id integer,
    team_id integer,
    assignee_id integer,
    priority character varying(50),
    occurred_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_audit_id bigint,
    source_key character varying(255)
);


--
-- Name: ticket_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_events_id_seq OWNED BY public.ticket_events.id;


--
-- Name: ticket_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_feedback (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    rating character varying(10) NOT NULL,
    comment text,
    contact_id integer NOT NULL,
    company_id integer,
    team_id integer,
    assignee_id integer,
    submitted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ticket_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_feedback_id_seq OWNED BY public.ticket_feedback.id;


--
-- Name: ticket_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_labels (
    ticket_id integer NOT NULL,
    label_id integer NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ticket_merges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_merges (
    id integer NOT NULL,
    source_id integer NOT NULL,
    target_id integer NOT NULL,
    actor character varying(255) NOT NULL,
    merged_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    unmerged_at timestamp(3) without time zone,
    undo_plan jsonb NOT NULL
);


--
-- Name: ticket_merges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_merges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_merges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_merges_id_seq OWNED BY public.ticket_merges.id;


--
-- Name: ticket_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_number_seq
    START WITH 10000
    INCREMENT BY 1
    MINVALUE 10000
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_sla_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_sla_snapshots (
    id bigint NOT NULL,
    ticket_id integer NOT NULL,
    policy_id integer,
    policy_name character varying(150),
    response_minutes integer,
    resolution_minutes integer,
    response_due_at timestamp(3) without time zone,
    resolution_due_at timestamp(3) without time zone,
    established_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ticket_sla_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_sla_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_sla_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_sla_snapshots_id_seq OWNED BY public.ticket_sla_snapshots.id;


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id integer NOT NULL,
    ticket_number character varying(50),
    title character varying(255) NOT NULL,
    summary character varying(500),
    description text,
    status character varying(100) DEFAULT 'New'::character varying NOT NULL,
    priority character varying(50),
    company_name character varying(150),
    company_id integer,
    contact_id integer,
    assignee character varying(100),
    assignee_id integer,
    team_id integer,
    custom_fields jsonb,
    source public."TicketSource" DEFAULT 'local'::public."TicketSource" NOT NULL,
    external_id character varying(255),
    external_provider character varying(50),
    sync_state public."SyncState",
    synced_at timestamp(3) without time zone,
    remote_hash character varying(64),
    remote_updated_at timestamp(3) without time zone,
    sync_revision integer DEFAULT 0 NOT NULL,
    sync_connection_id integer,
    sla_policy_id integer,
    response_due_at timestamp(3) without time zone,
    resolution_due_at timestamp(3) without time zone,
    first_responded_at timestamp(3) without time zone,
    due_at timestamp(3) without time zone,
    portal_access_revoked_at timestamp(3) without time zone,
    parent_id integer,
    merged_into_id integer,
    merged_at timestamp(3) without time zone,
    closed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tickets_id_seq OWNED BY public.tickets.id;


--
-- Name: user_portal_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_portal_profiles (
    user_id integer NOT NULL,
    display_name character varying(150),
    avatar_storage_key character varying(500),
    avatar_content_type character varying(150),
    avatar_storage_backend character varying(20),
    public_email character varying(255),
    public_phone character varying(50),
    opted_in boolean DEFAULT false NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    auth_provider public."AuthProvider" DEFAULT 'local'::public."AuthProvider" NOT NULL,
    subject character varying(255),
    username character varying(100) NOT NULL,
    password_hash character varying(255),
    display_name character varying(150),
    email character varying(255),
    role public."UserRole" DEFAULT 'technician'::public."UserRole" NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    totp_secret character varying(64),
    totp_enabled boolean DEFAULT false NOT NULL,
    totp_recovery jsonb,
    signature_html text,
    theme_pref character varying(40),
    kanban_columns jsonb,
    last_seen_at timestamp(3) without time zone,
    password_changed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: api_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_tokens ALTER COLUMN id SET DEFAULT nextval('public.api_tokens_id_seq'::regclass);


--
-- Name: attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments ALTER COLUMN id SET DEFAULT nextval('public.attachments_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: automation_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules ALTER COLUMN id SET DEFAULT nextval('public.automation_rules_id_seq'::regclass);


--
-- Name: checklist_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items ALTER COLUMN id SET DEFAULT nextval('public.checklist_items_id_seq'::regclass);


--
-- Name: checklist_template_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_template_items ALTER COLUMN id SET DEFAULT nextval('public.checklist_template_items_id_seq'::regclass);


--
-- Name: checklist_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_templates ALTER COLUMN id SET DEFAULT nextval('public.checklist_templates_id_seq'::regclass);


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections ALTER COLUMN id SET DEFAULT nextval('public.connections_id_seq'::regclass);


--
-- Name: contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts ALTER COLUMN id SET DEFAULT nextval('public.contacts_id_seq'::regclass);


--
-- Name: custom_field_defs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_defs ALTER COLUMN id SET DEFAULT nextval('public.custom_field_defs_id_seq'::regclass);


--
-- Name: device_external_refs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_external_refs ALTER COLUMN id SET DEFAULT nextval('public.device_external_refs_id_seq'::regclass);


--
-- Name: device_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_links ALTER COLUMN id SET DEFAULT nextval('public.device_links_id_seq'::regclass);


--
-- Name: devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices ALTER COLUMN id SET DEFAULT nextval('public.devices_id_seq'::regclass);


--
-- Name: kb_articles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_articles ALTER COLUMN id SET DEFAULT nextval('public.kb_articles_id_seq'::regclass);


--
-- Name: labels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels ALTER COLUMN id SET DEFAULT nextval('public.labels_id_seq'::regclass);


--
-- Name: mail_identities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_identities ALTER COLUMN id SET DEFAULT nextval('public.mail_identities_id_seq'::regclass);


--
-- Name: mail_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_templates ALTER COLUMN id SET DEFAULT nextval('public.mail_templates_id_seq'::regclass);


--
-- Name: mailboxes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailboxes ALTER COLUMN id SET DEFAULT nextval('public.mailboxes_id_seq'::regclass);


--
-- Name: notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes ALTER COLUMN id SET DEFAULT nextval('public.notes_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: oauth_auth_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_auth_codes ALTER COLUMN id SET DEFAULT nextval('public.oauth_auth_codes_id_seq'::regclass);


--
-- Name: oauth_clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients ALTER COLUMN id SET DEFAULT nextval('public.oauth_clients_id_seq'::regclass);


--
-- Name: portal_grants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_grants ALTER COLUMN id SET DEFAULT nextval('public.portal_grants_id_seq'::regclass);


--
-- Name: portal_magic_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_magic_links ALTER COLUMN id SET DEFAULT nextval('public.portal_magic_links_id_seq'::regclass);


--
-- Name: portal_registrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_registrations ALTER COLUMN id SET DEFAULT nextval('public.portal_registrations_id_seq'::regclass);


--
-- Name: probes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.probes ALTER COLUMN id SET DEFAULT nextval('public.probes_id_seq'::regclass);


--
-- Name: saved_views id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views ALTER COLUMN id SET DEFAULT nextval('public.saved_views_id_seq'::regclass);


--
-- Name: script_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_jobs ALTER COLUMN id SET DEFAULT nextval('public.script_jobs_id_seq'::regclass);


--
-- Name: sla_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_policies ALTER COLUMN id SET DEFAULT nextval('public.sla_policies_id_seq'::regclass);


--
-- Name: sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log ALTER COLUMN id SET DEFAULT nextval('public.sync_log_id_seq'::regclass);


--
-- Name: sync_providers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_providers ALTER COLUMN id SET DEFAULT nextval('public.sync_providers_id_seq'::regclass);


--
-- Name: sync_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs ALTER COLUMN id SET DEFAULT nextval('public.sync_runs_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: ticket_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_events ALTER COLUMN id SET DEFAULT nextval('public.ticket_events_id_seq'::regclass);


--
-- Name: ticket_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_feedback ALTER COLUMN id SET DEFAULT nextval('public.ticket_feedback_id_seq'::regclass);


--
-- Name: ticket_merges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_merges ALTER COLUMN id SET DEFAULT nextval('public.ticket_merges_id_seq'::regclass);


--
-- Name: ticket_sla_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_sla_snapshots ALTER COLUMN id SET DEFAULT nextval('public.ticket_sla_snapshots_id_seq'::regclass);


--
-- Name: tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets ALTER COLUMN id SET DEFAULT nextval('public.tickets_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: api_tokens api_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT api_tokens_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: auth_settings auth_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_settings
    ADD CONSTRAINT auth_settings_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: checklist_items checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_pkey PRIMARY KEY (id);


--
-- Name: checklist_template_items checklist_template_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_template_items
    ADD CONSTRAINT checklist_template_items_pkey PRIMARY KEY (id);


--
-- Name: checklist_templates checklist_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: connections connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connections
    ADD CONSTRAINT connections_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: custom_field_defs custom_field_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_defs
    ADD CONSTRAINT custom_field_defs_pkey PRIMARY KEY (id);


--
-- Name: device_external_refs device_external_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_external_refs
    ADD CONSTRAINT device_external_refs_pkey PRIMARY KEY (id);


--
-- Name: device_links device_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_links
    ADD CONSTRAINT device_links_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: kb_articles kb_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_pkey PRIMARY KEY (id);


--
-- Name: labels labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);


--
-- Name: mail_identities mail_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_identities
    ADD CONSTRAINT mail_identities_pkey PRIMARY KEY (id);


--
-- Name: mail_templates mail_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_templates
    ADD CONSTRAINT mail_templates_pkey PRIMARY KEY (id);


--
-- Name: mailboxes mailboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailboxes
    ADD CONSTRAINT mailboxes_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: oauth_auth_codes oauth_auth_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_auth_codes
    ADD CONSTRAINT oauth_auth_codes_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: portal_grants portal_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_grants
    ADD CONSTRAINT portal_grants_pkey PRIMARY KEY (id);


--
-- Name: portal_magic_links portal_magic_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_magic_links
    ADD CONSTRAINT portal_magic_links_pkey PRIMARY KEY (id);


--
-- Name: portal_registrations portal_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_registrations
    ADD CONSTRAINT portal_registrations_pkey PRIMARY KEY (id);


--
-- Name: probes probes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.probes
    ADD CONSTRAINT probes_pkey PRIMARY KEY (id);


--
-- Name: saved_views saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_pkey PRIMARY KEY (id);


--
-- Name: script_jobs script_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_jobs
    ADD CONSTRAINT script_jobs_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: sla_policies sla_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_policies
    ADD CONSTRAINT sla_policies_pkey PRIMARY KEY (id);


--
-- Name: sync_account_claims sync_account_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_account_claims
    ADD CONSTRAINT sync_account_claims_pkey PRIMARY KEY (account_key);


--
-- Name: sync_log sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_pkey PRIMARY KEY (id);


--
-- Name: sync_providers sync_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_providers
    ADD CONSTRAINT sync_providers_pkey PRIMARY KEY (id);


--
-- Name: sync_runs sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: ticket_events ticket_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_events
    ADD CONSTRAINT ticket_events_pkey PRIMARY KEY (id);


--
-- Name: ticket_feedback ticket_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_feedback
    ADD CONSTRAINT ticket_feedback_pkey PRIMARY KEY (id);


--
-- Name: ticket_labels ticket_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_labels
    ADD CONSTRAINT ticket_labels_pkey PRIMARY KEY (ticket_id, label_id);


--
-- Name: ticket_merges ticket_merges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_merges
    ADD CONSTRAINT ticket_merges_pkey PRIMARY KEY (id);


--
-- Name: ticket_sla_snapshots ticket_sla_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_sla_snapshots
    ADD CONSTRAINT ticket_sla_snapshots_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: user_portal_profiles user_portal_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_portal_profiles
    ADD CONSTRAINT user_portal_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: api_tokens_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX api_tokens_token_hash_key ON public.api_tokens USING btree (token_hash);


--
-- Name: api_tokens_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_tokens_user_id_idx ON public.api_tokens USING btree (user_id);


--
-- Name: attachments_note_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_note_id_idx ON public.attachments USING btree (note_id);


--
-- Name: attachments_ticket_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_ticket_id_idx ON public.attachments USING btree (ticket_id);


--
-- Name: checklist_items_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_due_at_idx ON public.checklist_items USING btree (due_at);


--
-- Name: checklist_items_ticket_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_ticket_id_idx ON public.checklist_items USING btree (ticket_id);


--
-- Name: checklist_template_items_template_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_template_items_template_id_idx ON public.checklist_template_items USING btree (template_id);


--
-- Name: checklist_templates_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checklist_templates_name_key ON public.checklist_templates USING btree (name);


--
-- Name: companies_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX companies_name_key ON public.companies USING btree (name);


--
-- Name: connections_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX connections_name_key ON public.connections USING btree (name);


--
-- Name: connections_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connections_type_idx ON public.connections USING btree (type);


--
-- Name: contacts_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_company_id_idx ON public.contacts USING btree (company_id);


--
-- Name: custom_field_defs_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX custom_field_defs_key_key ON public.custom_field_defs USING btree (key);


--
-- Name: device_external_refs_device_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_external_refs_device_id_idx ON public.device_external_refs USING btree (device_id);


--
-- Name: device_external_refs_device_id_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_external_refs_device_id_provider_key ON public.device_external_refs USING btree (device_id, provider);


--
-- Name: device_external_refs_provider_external_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_external_refs_provider_external_id_key ON public.device_external_refs USING btree (provider, external_id);


--
-- Name: device_links_ticket_id_device_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_links_ticket_id_device_id_key ON public.device_links USING btree (ticket_id, device_id);


--
-- Name: devices_company_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_company_name_idx ON public.devices USING btree (company_name);


--
-- Name: devices_external_id_external_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX devices_external_id_external_provider_key ON public.devices USING btree (external_id, external_provider);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_time ON public.audit_log USING btree (occurred_at);


--
-- Name: idx_devices_company_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_company_status ON public.devices USING btree (company_name, status) WHERE (company_name IS NOT NULL);


--
-- Name: idx_kb_articles_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_fts ON public.kb_articles USING gin ((((setweight(to_tsvector('english'::regconfig, (COALESCE(title, ''::character varying))::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, (COALESCE(category, ''::character varying))::text), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(body_text, ''::text)), 'C'::"char"))));


--
-- Name: idx_kb_articles_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_title_trgm ON public.kb_articles USING gin (lower((COALESCE(title, ''::character varying))::text) public.gin_trgm_ops);


--
-- Name: idx_kb_articles_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_trgm ON public.kb_articles USING gin (lower((((((COALESCE(title, ''::character varying))::text || ' '::text) || (COALESCE(category, ''::character varying))::text) || ' '::text) || COALESCE(body_text, ''::text))) public.gin_trgm_ops);


--
-- Name: idx_notes_content_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_content_trgm ON public.notes USING gin (lower(content) public.gin_trgm_ops);


--
-- Name: idx_notes_time_author_worked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_time_author_worked ON public.notes USING btree (author_id, worked_at) WHERE ((note_type = 'time_entry'::public."NoteType") AND (worked_at IS NOT NULL));


--
-- Name: idx_notes_time_worked_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_time_worked_ticket ON public.notes USING btree (worked_at, ticket_id) WHERE ((note_type = 'time_entry'::public."NoteType") AND (worked_at IS NOT NULL));


--
-- Name: idx_sync_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_provider ON public.sync_log USING btree (provider_id, synced_at);


--
-- Name: idx_sync_run_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_run_log ON public.sync_log USING btree (run_id, synced_at);


--
-- Name: idx_sync_run_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_run_provider ON public.sync_runs USING btree (provider_id, started_at);


--
-- Name: idx_sync_run_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_run_status ON public.sync_runs USING btree (status, started_at);


--
-- Name: idx_ticket_events_assignee_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_events_assignee_occurred ON public.ticket_events USING btree (assignee_id, occurred_at);


--
-- Name: idx_ticket_events_backfill_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_events_backfill_occurred ON public.ticket_events USING btree (occurred_at) WHERE ((actor)::text = 'backfill'::text);


--
-- Name: idx_ticket_events_company_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_events_company_occurred ON public.ticket_events USING btree (company_id, occurred_at);


--
-- Name: idx_ticket_events_kind_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_events_kind_occurred ON public.ticket_events USING btree (kind, occurred_at);


--
-- Name: idx_ticket_events_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_events_occurred ON public.ticket_events USING btree (occurred_at);


--
-- Name: idx_ticket_events_team_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_events_team_occurred ON public.ticket_events USING btree (team_id, occurred_at);


--
-- Name: idx_ticket_events_ticket_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_events_ticket_occurred ON public.ticket_events USING btree (ticket_id, occurred_at);


--
-- Name: idx_ticket_sla_snapshots_resolution_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_sla_snapshots_resolution_due ON public.ticket_sla_snapshots USING btree (resolution_due_at);


--
-- Name: idx_ticket_sla_snapshots_response_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_sla_snapshots_response_due ON public.ticket_sla_snapshots USING btree (response_due_at);


--
-- Name: idx_ticket_sla_snapshots_ticket_established; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_sla_snapshots_ticket_established ON public.ticket_sla_snapshots USING btree (ticket_id, established_at);


--
-- Name: idx_tickets_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_active ON public.tickets USING btree (company_name, status, created_at DESC) WHERE ((status)::text <> 'Deleted'::text);


--
-- Name: idx_tickets_external_legacy_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tickets_external_legacy_unique ON public.tickets USING btree (external_id, external_provider) WHERE ((sync_connection_id IS NULL) AND (external_id IS NOT NULL) AND (external_provider IS NOT NULL));


--
-- Name: idx_tickets_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_fts ON public.tickets USING gin (to_tsvector('english'::regconfig, (((((((COALESCE(title, ''::character varying))::text || ' '::text) || (COALESCE(summary, ''::character varying))::text) || ' '::text) || COALESCE(description, ''::text)) || ' '::text) || (COALESCE(company_name, ''::character varying))::text)));


--
-- Name: idx_tickets_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_trgm ON public.tickets USING gin (lower((((((((((((COALESCE(title, ''::character varying))::text || ' '::text) || (COALESCE(summary, ''::character varying))::text) || ' '::text) || COALESCE(description, ''::text)) || ' '::text) || (COALESCE(company_name, ''::character varying))::text) || ' '::text) || (COALESCE(priority, ''::character varying))::text) || ' '::text) || (COALESCE(ticket_number, ''::character varying))::text)) public.gin_trgm_ops);


--
-- Name: kb_articles_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_articles_category_idx ON public.kb_articles USING btree (category);


--
-- Name: kb_articles_deleted_at_visibility_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_articles_deleted_at_visibility_published_idx ON public.kb_articles USING btree (deleted_at, visibility, published);


--
-- Name: kb_articles_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_articles_slug_key ON public.kb_articles USING btree (slug);


--
-- Name: labels_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX labels_name_key ON public.labels USING btree (name);


--
-- Name: mail_identities_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mail_identities_address_key ON public.mail_identities USING btree (address);


--
-- Name: mail_identities_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mail_identities_user_id_idx ON public.mail_identities USING btree (user_id);


--
-- Name: notifications_user_id_read_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_read_at_idx ON public.notifications USING btree (user_id, read_at);


--
-- Name: oauth_auth_codes_code_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX oauth_auth_codes_code_hash_key ON public.oauth_auth_codes USING btree (code_hash);


--
-- Name: oauth_auth_codes_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_auth_codes_expires_at_idx ON public.oauth_auth_codes USING btree (expires_at);


--
-- Name: oauth_clients_client_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX oauth_clients_client_id_key ON public.oauth_clients USING btree (client_id);


--
-- Name: portal_grants_contact_id_revoked_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_grants_contact_id_revoked_at_idx ON public.portal_grants USING btree (contact_id, revoked_at);


--
-- Name: portal_magic_links_contact_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_magic_links_contact_id_created_at_idx ON public.portal_magic_links USING btree (contact_id, created_at);


--
-- Name: portal_magic_links_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_magic_links_expires_at_idx ON public.portal_magic_links USING btree (expires_at);


--
-- Name: portal_magic_links_selector_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX portal_magic_links_selector_hash_key ON public.portal_magic_links USING btree (selector_hash);


--
-- Name: portal_registrations_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_registrations_email_idx ON public.portal_registrations USING btree (email);


--
-- Name: portal_registrations_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_registrations_status_created_at_idx ON public.portal_registrations USING btree (status, created_at);


--
-- Name: probes_api_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX probes_api_key_key ON public.probes USING btree (api_key);


--
-- Name: saved_views_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_views_user_id_idx ON public.saved_views USING btree (user_id);


--
-- Name: script_jobs_device_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX script_jobs_device_id_idx ON public.script_jobs USING btree (device_id);


--
-- Name: script_jobs_status_scheduled_for_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX script_jobs_status_scheduled_for_idx ON public.script_jobs USING btree (status, scheduled_for);


--
-- Name: sessions_contact_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_contact_id_idx ON public.sessions USING btree (contact_id);


--
-- Name: sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_expires_at_idx ON public.sessions USING btree (expires_at);


--
-- Name: sessions_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_token_hash_key ON public.sessions USING btree (token_hash);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: sla_policies_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sla_policies_company_id_idx ON public.sla_policies USING btree (company_id);


--
-- Name: sync_account_claims_claimed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_account_claims_claimed_at_idx ON public.sync_account_claims USING btree (claimed_at);


--
-- Name: sync_account_claims_owner_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sync_account_claims_owner_token_key ON public.sync_account_claims USING btree (owner_token);


--
-- Name: sync_providers_connection_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_providers_connection_id_idx ON public.sync_providers USING btree (connection_id);


--
-- Name: sync_providers_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sync_providers_name_key ON public.sync_providers USING btree (name);


--
-- Name: teams_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX teams_name_key ON public.teams USING btree (name);


--
-- Name: ticket_events_source_audit_kind_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ticket_events_source_audit_kind_key ON public.ticket_events USING btree (source_audit_id, kind);


--
-- Name: ticket_events_source_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ticket_events_source_key_key ON public.ticket_events USING btree (source_key);


--
-- Name: ticket_feedback_assignee_id_submitted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_feedback_assignee_id_submitted_at_idx ON public.ticket_feedback USING btree (assignee_id, submitted_at);


--
-- Name: ticket_feedback_company_id_submitted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_feedback_company_id_submitted_at_idx ON public.ticket_feedback USING btree (company_id, submitted_at);


--
-- Name: ticket_feedback_ticket_id_submitted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_feedback_ticket_id_submitted_at_idx ON public.ticket_feedback USING btree (ticket_id, submitted_at);


--
-- Name: ticket_labels_label_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_labels_label_id_idx ON public.ticket_labels USING btree (label_id);


--
-- Name: ticket_merges_one_live_per_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ticket_merges_one_live_per_source ON public.ticket_merges USING btree (source_id) WHERE (unmerged_at IS NULL);


--
-- Name: ticket_merges_source_id_unmerged_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_merges_source_id_unmerged_at_idx ON public.ticket_merges USING btree (source_id, unmerged_at);


--
-- Name: ticket_merges_target_id_merged_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ticket_merges_target_id_merged_at_idx ON public.ticket_merges USING btree (target_id, merged_at);


--
-- Name: tickets_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_company_id_idx ON public.tickets USING btree (company_id);


--
-- Name: tickets_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_due_at_idx ON public.tickets USING btree (due_at);


--
-- Name: tickets_external_id_external_provider_sync_connection_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tickets_external_id_external_provider_sync_connection_id_key ON public.tickets USING btree (external_id, external_provider, sync_connection_id);


--
-- Name: tickets_merged_into_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_merged_into_id_idx ON public.tickets USING btree (merged_into_id);


--
-- Name: tickets_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_parent_id_idx ON public.tickets USING btree (parent_id);


--
-- Name: tickets_portal_access_revoked_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_portal_access_revoked_at_idx ON public.tickets USING btree (portal_access_revoked_at);


--
-- Name: tickets_resolution_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_resolution_due_at_idx ON public.tickets USING btree (resolution_due_at);


--
-- Name: tickets_response_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_response_due_at_idx ON public.tickets USING btree (response_due_at);


--
-- Name: tickets_sync_connection_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_sync_connection_id_idx ON public.tickets USING btree (sync_connection_id);


--
-- Name: tickets_team_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tickets_team_id_idx ON public.tickets USING btree (team_id);


--
-- Name: users_auth_provider_subject_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_auth_provider_subject_key ON public.users USING btree (auth_provider, subject);


--
-- Name: users_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username);


--
-- Name: ticket_events trg_ticket_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ticket_events_append_only BEFORE DELETE OR UPDATE ON public.ticket_events FOR EACH ROW EXECUTE FUNCTION public.anchordesk_reject_reporting_fact_mutation();


--
-- Name: ticket_sla_snapshots trg_ticket_sla_snapshots_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ticket_sla_snapshots_append_only BEFORE DELETE OR UPDATE ON public.ticket_sla_snapshots FOR EACH ROW EXECUTE FUNCTION public.anchordesk_reject_reporting_fact_mutation();


--
-- Name: tickets trg_tickets_single_level_hierarchy; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tickets_single_level_hierarchy BEFORE INSERT OR UPDATE OF parent_id ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.anchordesk_assert_single_level_hierarchy();


--
-- Name: api_tokens api_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: attachments attachments_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: attachments attachments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: checklist_items checklist_items_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: checklist_template_items checklist_template_items_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_template_items
    ADD CONSTRAINT checklist_template_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.checklist_templates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: contacts contacts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: device_external_refs device_external_refs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_external_refs
    ADD CONSTRAINT device_external_refs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: device_links device_links_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_links
    ADD CONSTRAINT device_links_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: device_links device_links_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_links
    ADD CONSTRAINT device_links_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: devices devices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: devices devices_probe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_probe_id_fkey FOREIGN KEY (probe_id) REFERENCES public.probes(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: mail_identities mail_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_identities
    ADD CONSTRAINT mail_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notes notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notes notes_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: portal_grants portal_grants_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_grants
    ADD CONSTRAINT portal_grants_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: portal_magic_links portal_magic_links_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_magic_links
    ADD CONSTRAINT portal_magic_links_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: portal_registrations portal_registrations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_registrations
    ADD CONSTRAINT portal_registrations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: portal_registrations portal_registrations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_registrations
    ADD CONSTRAINT portal_registrations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: probes probes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.probes
    ADD CONSTRAINT probes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: saved_views saved_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: script_jobs script_jobs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_jobs
    ADD CONSTRAINT script_jobs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: script_jobs script_jobs_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.script_jobs
    ADD CONSTRAINT script_jobs_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sessions sessions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sync_log sync_log_internal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_internal_id_fkey FOREIGN KEY (internal_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sync_log sync_log_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.sync_providers(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sync_log sync_log_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.sync_runs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sync_providers sync_providers_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_providers
    ADD CONSTRAINT sync_providers_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sync_runs sync_runs_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.sync_providers(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ticket_feedback ticket_feedback_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_feedback
    ADD CONSTRAINT ticket_feedback_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ticket_feedback ticket_feedback_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_feedback
    ADD CONSTRAINT ticket_feedback_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ticket_labels ticket_labels_label_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_labels
    ADD CONSTRAINT ticket_labels_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.labels(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ticket_labels ticket_labels_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_labels
    ADD CONSTRAINT ticket_labels_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ticket_merges ticket_merges_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_merges
    ADD CONSTRAINT ticket_merges_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ticket_merges ticket_merges_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_merges
    ADD CONSTRAINT ticket_merges_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tickets tickets_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tickets tickets_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tickets tickets_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tickets tickets_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tickets tickets_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.tickets(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tickets tickets_sla_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_sla_policy_id_fkey FOREIGN KEY (sla_policy_id) REFERENCES public.sla_policies(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tickets tickets_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: user_portal_profiles user_portal_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_portal_profiles
    ADD CONSTRAINT user_portal_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


