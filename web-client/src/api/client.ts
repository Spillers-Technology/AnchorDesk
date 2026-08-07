/**
 * Thin API client for anchordesk backend.
 *
 * All fetch calls go through here so auth headers, base URL,
 * and error handling are handled consistently in one place.
 *
 * Token injection: call setAuthToken() once after OIDC login;
 * every subsequent request will include the bearer header automatically.
 */

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Thrown on non-2xx so callers can branch on status (e.g. 401 → show login). */
export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Session auth rides on a cookie; include credentials so it's sent through the proxy.
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body, `API ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function requestForm<T>(path: string, body: FormData, method = "POST"): Promise<T> {
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`/api${path}`, { method, body, headers, credentials: "same-origin" });
  if (!res.ok) {
    const responseBody = await res.text();
    throw new ApiError(res.status, responseBody, `API ${method} ${path} → ${res.status}: ${responseBody}`);
  }
  return res.json() as Promise<T>;
}

async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`/api${path}`, {
    headers,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body, `API GET ${path} → ${res.status}: ${body}`);
  }
  return res.blob();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: "admin" | "technician" | "readonly";
  authProvider: string;
  themePref: string | null;
  /** Ordered Kanban statuses selected by this user; null uses the default board. */
  kanbanColumns: string[] | null;
}

/** Persist the current user's UI theme preference (a palette id, or null to reset). */
export function setMyTheme(themePref: string | null) {
  return request<{ themePref: string | null }>("/auth/theme", {
    method: "PUT",
    body: JSON.stringify({ themePref }),
  });
}

/** Persist the current user's ordered Kanban column selection. */
export function setMyKanbanColumns(kanbanColumns: string[] | null) {
  return request<{ kanbanColumns: string[] | null }>("/auth/kanban-columns", {
    method: "PUT",
    body: JSON.stringify({ kanbanColumns }),
  });
}

export interface LoginOptions {
  local: boolean;
  oidc: boolean;
  saml: boolean;
}

/** Which login methods to show on the login screen (public endpoint). */
export function getAuthConfig() {
  return request<LoginOptions>("/auth/config");
}

export interface LoginResult {
  user?: AuthUser;
  mfaRequired?: boolean;
  enrollmentRequired?: boolean;
}

export function login(username: string, password: string) {
  return request<LoginResult>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function verifyMfa(code: string) {
  return request<{ user: AuthUser }>("/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function setupMfa() {
  return request<{ otpauthUrl: string; qr: string; secret: string }>("/auth/mfa/setup", { method: "POST" });
}

export function enableMfa(code: string) {
  return request<{ ok: boolean; recoveryCodes: string[]; user: AuthUser }>("/auth/mfa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function disableMfa() {
  return request<{ ok: boolean }>("/auth/mfa", { method: "DELETE" });
}

export function logout() {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export function getMe() {
  return request<{ user: AuthUser }>("/auth/me");
}

export function changeOwnPassword(currentPassword: string, newPassword: string) {
  return request<{ ok: boolean }>("/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

// ─── Personal access tokens (self-service) ───────────────────────────────────

export interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function listApiTokens() {
  return request<ApiToken[]>("/auth/tokens");
}

/** Create a token. The raw `secret` is returned exactly once — surface it now. */
export function createApiToken(name: string, expiresInDays?: number) {
  return request<{ token: ApiToken; secret: string }>("/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ name, expiresInDays }),
  });
}

export function revokeApiToken(id: number) {
  return request<{ ok: boolean }>(`/auth/tokens/${id}`, { method: "DELETE" });
}

// ─── Admin: users ──────────────────────────────────────────────────────────────

export interface ManagedUser extends AuthUser {
  isActive: boolean;
  hasPassword: boolean;
  mfaEnabled: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export function listUsers() {
  return request<ManagedUser[]>("/users");
}

export interface Assignee {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
}

/** Active admins + technicians, for the ticket assignee picker. */
export function listAssignees() {
  return request<Assignee[]>("/assignees");
}

// ─── Teams / queues ───────────────────────────────────────────────────

export interface TeamMember {
  teamId: number;
  userId: number;
  user: Pick<ManagedUser, "id" | "username" | "displayName" | "role">;
}

export interface Team {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  members: TeamMember[];
  _count?: { tickets: number };
}

export function listTeams() {
  return request<Team[]>("/teams");
}
export function createTeam(data: { name: string; description?: string | null }) {
  return request<Team>("/teams", { method: "POST", body: JSON.stringify(data) });
}
export function updateTeam(id: number, data: { name?: string; description?: string | null }) {
  return request<Team>(`/teams/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteTeam(id: number) {
  return request<void>(`/teams/${id}`, { method: "DELETE" });
}
export function addTeamMember(teamId: number, userId: number) {
  return request<Team>(`/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}
export function removeTeamMember(teamId: number, userId: number) {
  return request<Team>(`/teams/${teamId}/members/${userId}`, { method: "DELETE" });
}

// ─── Custom ticket fields ──────────────────────────────────────────────

export type CustomFieldType = "text" | "number" | "boolean" | "date" | "select";

export interface CustomFieldDef {
  id: number;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[] | null;
  required: boolean;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CustomFieldDefInput = Pick<CustomFieldDef, "key" | "label" | "type"> &
  Partial<Pick<CustomFieldDef, "options" | "required" | "sortOrder" | "archived">>;

export function listCustomFields(includeArchived = false) {
  const query = includeArchived ? "?includeArchived=true" : "";
  return request<CustomFieldDef[]>(`/custom-fields${query}`);
}
export function createCustomField(data: CustomFieldDefInput) {
  return request<CustomFieldDef>("/custom-fields", { method: "POST", body: JSON.stringify(data) });
}
export function updateCustomField(id: number, data: Partial<Omit<CustomFieldDefInput, "key" | "type">>) {
  return request<CustomFieldDef>(`/custom-fields/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteCustomField(id: number) {
  return request<void>(`/custom-fields/${id}`, { method: "DELETE" });
}

// ─── Automation rules ───────────────────────────────────────────────────

export type AutomationTrigger = "ticket_created" | "ticket_updated" | "note_added" | "sla_at_risk" | "sla_breached";
export type AutomationConditionOp = "eq" | "neq" | "contains" | "in" | "gte" | "lte" | "set" | "unset";
export interface AutomationCondition { field: string; op: AutomationConditionOp; value?: unknown }
export type AutomationAction = Record<string, unknown> & { type: string };
export interface AutomationRule {
  id: number;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type AutomationRuleInput = Pick<AutomationRule, "name" | "trigger" | "conditions" | "actions"> &
  Partial<Pick<AutomationRule, "enabled">>;

export function listAutomations() {
  return request<AutomationRule[]>("/automations");
}
export function createAutomation(data: AutomationRuleInput) {
  return request<AutomationRule>("/automations", { method: "POST", body: JSON.stringify(data) });
}
export function updateAutomation(id: number, data: Partial<AutomationRuleInput>) {
  return request<AutomationRule>(`/automations/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteAutomation(id: number) {
  return request<void>(`/automations/${id}`, { method: "DELETE" });
}

// ─── Saved views ───────────────────────────────────────────────────────

export interface SavedViewFilters {
  status?: string;
  assignee?: string;
  company?: string;
  q?: string;
  regex?: string;
  labelId?: number;
  teamId?: number;
  customFields?: Record<string, string | number | boolean>;
  includeClosed?: boolean;
}
export interface SavedView {
  id: number;
  userId: number | null;
  name: string;
  filters: SavedViewFilters;
  shared: boolean;
  sortOrder: number;
  createdAt: string;
}
export type SavedViewInput = Pick<SavedView, "name" | "filters"> & Partial<Pick<SavedView, "shared" | "sortOrder">>;

export function listSavedViews() {
  return request<SavedView[]>("/views");
}
export function createSavedView(data: SavedViewInput) {
  return request<SavedView>("/views", { method: "POST", body: JSON.stringify(data) });
}
export function updateSavedView(id: number, data: Partial<SavedViewInput>) {
  return request<SavedView>(`/views/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteSavedView(id: number) {
  return request<void>(`/views/${id}`, { method: "DELETE" });
}

export function createUser(data: {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  role?: string;
}) {
  return request<ManagedUser>("/users", { method: "POST", body: JSON.stringify(data) });
}

export function updateUser(
  id: number,
  data: { displayName?: string; email?: string; role?: string; isActive?: boolean }
) {
  return request<ManagedUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function setUserPassword(id: number, password: string) {
  return request<{ ok: boolean }>(`/users/${id}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function deleteUser(id: number) {
  return request<void>(`/users/${id}`, { method: "DELETE" });
}

// ─── Admin: auth settings ────────────────────────────────────────────────────────

export interface AuthSettings {
  localEnabled: boolean;
  oidc: { enabled: boolean; issuerUrl: string | null; clientId: string | null; redirectUri: string; hasClientSecret: boolean };
  saml: { enabled: boolean; entryPoint: string | null; issuer: string | null; callbackUrl: string; hasIdpCert: boolean };
  mfa: { required: boolean; issuer: string };
}

export function getAuthSettings() {
  return request<AuthSettings>("/auth/settings");
}

export function updateAuthSettings(data: Record<string, unknown>) {
  return request<AuthSettings>("/auth/settings", { method: "PATCH", body: JSON.stringify(data) });
}

// ─── Admin console ───────────────────────────────────────────────────────────

export interface AdminOverview {
  tickets: { open: number; total: number };
  devices: { total: number; online: number };
  probes: { total: number; online: number };
  users: number;
  mailboxes: number;
  recentAudit: AuditEvent[];
}

export interface AuditEvent {
  id: string;
  entityType: string;
  entityId: number;
  action: string;
  changedBy: string | null;
  oldValue: unknown;
  newValue: unknown;
  occurredAt: string;
}

export function getAdminOverview() {
  return request<AdminOverview>("/admin/overview");
}

export function getAuditLog(opts: { entityType?: string; action?: string; limit?: number } = {}) {
  const p = new URLSearchParams();
  if (opts.entityType) p.set("entityType", opts.entityType);
  if (opts.action) p.set("action", opts.action);
  if (opts.limit) p.set("limit", String(opts.limit));
  return request<AuditEvent[]>(`/admin/audit?${p}`);
}

// ─── Integrations ────────────────────────────────────────────────────────────

export interface StorageView {
  backend?: "local" | "s3";
  localDir?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3ForcePathStyle?: boolean;
  hasS3SecretAccessKey?: boolean;
}

export interface IntegrationsView {
  smtp: { host?: string; port?: number; secure?: boolean; user?: string; from?: string; hasPass?: boolean };
  connectwise: { server?: string; company?: string; publicKey?: string; hasPrivateKey?: boolean; hasClientId?: boolean };
  jira: { baseUrl?: string; email?: string; hasApiToken?: boolean };
  tactical: { apiUrl?: string; hasApiKey?: boolean };
  ninjaone: { apiUrl?: string; clientId?: string; scope?: string; hasClientSecret?: boolean };
  datto: { apiUrl?: string; apiKey?: string; hasApiSecretKey?: boolean };
  storage: StorageView;
  tickets: { numberDigits?: number };
}

export function getIntegrations() {
  return request<IntegrationsView>("/integrations");
}

export function updateIntegration(
  key: "smtp" | "connectwise" | "jira" | "tactical" | "ninjaone" | "datto" | "storage" | "tickets",
  data: Record<string, unknown>
) {
  return request<Record<string, unknown>>(`/integrations/${key}`, { method: "PATCH", body: JSON.stringify(data) });
}

// ─── Interface preferences (ui settings) ─────────────────────────────────────

export interface UiSettings {
  legacyTableView: boolean;
}

/** Readable by any authenticated user — drives nav/view gating. */
export function getUiSettings() {
  return request<UiSettings>("/ui-settings");
}

/** Admin-only write. */
export function updateUiSettings(data: Partial<UiSettings>) {
  return request<UiSettings>("/ui-settings", { method: "PATCH", body: JSON.stringify(data) });
}

// ─── Customer portal switch ──────────────────────────────────────────────────

export interface PortalSettings {
  enabled: boolean;
  ticketScope: "own" | "company";
  technicianIdentity: "anonymous" | "named";
  allowAttachments: boolean;
  allowSelfSolve: boolean;
}

/** Admin-only in both directions, unlike ui-settings. */
export function getPortalSettings() {
  return request<PortalSettings>("/portal-settings");
}

export function updatePortalSettings(data: Partial<PortalSettings>) {
  return request<PortalSettings>("/portal-settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export interface FeedbackSettings {
  enabled: boolean;
  promptOnSolve: boolean;
}

export function getFeedbackSettings() {
  return request<FeedbackSettings>("/feedback-settings");
}

export function updateFeedbackSettings(data: Partial<FeedbackSettings>) {
  return request<FeedbackSettings>("/feedback-settings", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ─── Mailboxes (IMAP email-to-ticket) ─────────────────────────────────────────

export interface Mailbox {
  id: number;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
  folder: string;
  companyName: string | null;
  enabled: boolean;
  lastUid: number | null;
  lastPolledAt: string | null;
  lastError: string | null;
}

export function listMailboxes() {
  return request<Mailbox[]>("/mailboxes");
}

export function createMailbox(data: Record<string, unknown>) {
  return request<Mailbox>("/mailboxes", { method: "POST", body: JSON.stringify(data) });
}

export function updateMailbox(id: number, data: Record<string, unknown>) {
  return request<Mailbox>(`/mailboxes/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteMailbox(id: number) {
  return request<void>(`/mailboxes/${id}`, { method: "DELETE" });
}

export function pollMailbox(id: number) {
  return request<{ mailbox: string; processed: number; created: number; appended: number; error?: string }>(
    `/mailboxes/${id}/poll`,
    { method: "POST" }
  );
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export interface TicketFilters {
  status?: string;
  assignee?: string;
  company?: string;
  q?: string;
  /** POSIX regex matched server-side across ticket text. */
  regex?: string;
  labelId?: number;
  teamId?: number;
  /** Exact JSONB field matches; serialized as cf.<key>=value query params. */
  customFields?: Record<string, string | number | boolean>;
  /** Include closed tickets (default false hides them from working views). */
  includeClosed?: boolean;
  /** Restrict results to the direct children of one ticket. */
  parentId?: number;
  /** Restrict results to tickets with or without a parent. */
  hasParent?: boolean;
  page?: number;
  pageSize?: number;
}

export interface TicketPage {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
}

export function listTickets(filters: TicketFilters = {}) {
  const { customFields, ...normalFilters } = filters;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(normalFilters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  for (const [key, value] of Object.entries(customFields ?? {})) {
    if (value !== "") params.set(`cf.${key}`, String(value));
  }
  return request<TicketPage>(`/tickets?${params}`);
}

export function getTicket(id: number) {
  return request<unknown>(`/tickets/${id}`);
}

/** Postgres full-text search across ticket title/summary/description/company. */
export function searchTickets(q: string, limit = 100) {
  return request<unknown[]>(`/tickets/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export interface MergeTicketSummary {
  id: number;
  ticketNumber: string;
  title: string;
}

export interface MergePreviewMoveCounts {
  notes: number;
  attachments: number;
  checklistItems: number;
  children: number;
  labels: number;
  deviceLinks: number;
}

export interface MergePreviewNotice {
  code: string;
  message: string;
}

export interface MergePreview {
  source: MergeTicketSummary;
  target: MergeTicketSummary;
  moves: MergePreviewMoveCounts;
  warnings: MergePreviewNotice[];
  blockers: MergePreviewNotice[];
}

export interface TicketRelationFields {
  parentId: number | null;
  mergedIntoId: number | null;
  mergedAt: string | null;
}

export type RelatedTicketRecord = Record<string, unknown> & TicketRelationFields;

export function mergePreview(sourceId: number, targetId: number) {
  return request<MergePreview>(`/tickets/${sourceId}/merge-preview?targetId=${targetId}`);
}

export function mergeTicket(sourceId: number, targetId: number, acknowledge?: string[]) {
  return request<RelatedTicketRecord>(`/tickets/${sourceId}/merge`, {
    method: "POST",
    body: JSON.stringify({ targetId, ...(acknowledge?.length ? { acknowledge } : {}) }),
  });
}

export function unmergeTicket(sourceId: number) {
  return request<RelatedTicketRecord>(`/tickets/${sourceId}/unmerge`, { method: "POST" });
}

export function setTicketParent(ticketId: number, parentId: number | null) {
  return request<RelatedTicketRecord>(`/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify({ parentId }),
  });
}

// ─── Companies & contacts (CRM) ────────────────────────────────────────────────

export interface Contact {
  id: number;
  companyId: number;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
}

export interface Company {
  id: number;
  name: string;
  domain: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  contacts?: Contact[];
  _count?: { tickets: number; contacts: number; devices: number };
}

export function listCompanies() {
  return request<Company[]>("/companies");
}
export function getCompany(id: number) {
  return request<Company>(`/companies/${id}`);
}
export function createCompany(data: Partial<Company>) {
  return request<Company>("/companies", { method: "POST", body: JSON.stringify(data) });
}
export function updateCompany(id: number, data: Partial<Company>) {
  return request<Company>(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteCompany(id: number) {
  return request<void>(`/companies/${id}`, { method: "DELETE" });
}
export function getCompanyTickets(id: number) {
  return request<unknown[]>(`/companies/${id}/tickets`);
}
export function getCompanyDevices(id: number) {
  return request<unknown[]>(`/companies/${id}/devices`);
}
export function getCompanyTime(id: number) {
  return request<{ minutes: number }>(`/companies/${id}/time`);
}
/** Turn legacy companyName strings into linked Company records (admin). */
export function backfillCompanies() {
  return request<{ companies: number; tickets: number; devices: number }>("/companies/backfill", { method: "POST" });
}

export function createContact(companyId: number, data: Partial<Contact>) {
  return request<Contact>(`/companies/${companyId}/contacts`, { method: "POST", body: JSON.stringify(data) });
}
export function updateContact(id: number, data: Partial<Contact>) {
  return request<Contact>(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteContact(id: number) {
  return request<void>(`/contacts/${id}`, { method: "DELETE" });
}

// ─── Portal access (Portal v2) ──────────────────────────────────────────────

export interface PortalGrant {
  id: number;
  contactId: number;
  companyId: number;
  grantedBy: string;
  grantedAt: string;
  effectiveFrom: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

export function listContactPortalGrants(contactId: number) {
  return request<PortalGrant[]>(`/contacts/${contactId}/portal-grants`);
}
export function grantPortalAccess(contactId: number, effectiveFrom?: string) {
  return request<PortalGrant>(`/contacts/${contactId}/portal-grant`, {
    method: "POST",
    body: JSON.stringify(effectiveFrom ? { effectiveFrom } : {}),
  });
}
export function revokePortalAccess(contactId: number) {
  return request<PortalGrant>(`/contacts/${contactId}/portal-grant/revoke`, { method: "POST" });
}

export interface PortalProfile {
  displayName: string | null;
  avatarUrl: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  optedIn: boolean;
}

export function getMyPortalProfile() {
  return request<PortalProfile>("/auth/portal-profile");
}

export function setMyPortalProfile(data: Omit<PortalProfile, "avatarUrl">) {
  return request<PortalProfile>("/auth/portal-profile", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function uploadMyPortalProfileAvatar(file: File) {
  const body = new FormData();
  body.append("avatar", file, file.name);
  return requestForm<PortalProfile>("/auth/portal-profile/avatar", body);
}

export interface PortalRegistration {
  id: number;
  email: string;
  companyId: number | null;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  contactId: number | null;
  createdAt: string;
  company: { id: number; name: string; domain: string | null } | null;
  contact: { id: number; name: string; email: string | null; companyId: number } | null;
}

/** Public endpoint; kept here too so browser consumers share one typed API contract. */
export function requestPortalRegistration(email: string) {
  return request<{ ok: true; message: string }>("/portal/register", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}
export function listPortalRegistrations(status?: PortalRegistration["status"]) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<PortalRegistration[]>(`/portal-registrations${query}`);
}
export function approvePortalRegistration(id: number) {
  return request<PortalRegistration>(`/portal-registrations/${id}/approve`, { method: "POST" });
}
export function rejectPortalRegistration(id: number) {
  return request<PortalRegistration>(`/portal-registrations/${id}/reject`, { method: "POST" });
}

// ─── Time tracking ──────────────────────────────────────────────────────────────

export function getTicketTime(ticketId: number) {
  return request<{ minutes: number }>(`/tickets/${ticketId}/time`);
}
export function logTicketTime(ticketId: number, minutes: number, note?: string) {
  return request<unknown>(`/tickets/${ticketId}/time`, {
    method: "POST",
    body: JSON.stringify({ minutes, note }),
  });
}
/** Log time from a start/stop window; the backend derives the duration. */
export function logTicketTimeRange(ticketId: number, start: string, stop: string, note?: string) {
  return request<unknown>(`/tickets/${ticketId}/time`, {
    method: "POST",
    body: JSON.stringify({ start, stop, note }),
  });
}

export function createTicket(data: Record<string, unknown>) {
  return request<unknown>('/tickets', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTicket(id: number, data: Record<string, unknown>) {
  return request<unknown>(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteTicket(id: number) {
  return request<void>(`/tickets/${id}`, { method: 'DELETE' });
}

export function getTicketHistory(id: number) {
  return request<unknown[]>(`/tickets/${id}/history`);
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export function listNotes(ticketId: number) {
  return request<unknown[]>(`/tickets/${ticketId}/notes`);
}

type CreateLocalNoteInput = {
  /** Only locally-authored conversation note types are accepted here. */
  noteType?: "note" | "internal";
  /** Internal unless explicitly published; omit to stay internal. */
  visibility?: "internal" | "public";
} & (
  | { content: string; htmlContent?: string }
  | { content?: string; htmlContent: string }
);

export function createNote(ticketId: number, data: CreateLocalNoteInput) {
  return request<unknown>(`/tickets/${ticketId}/notes`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateNote(ticketId: number, noteId: number, data: Record<string, unknown>) {
  return request<unknown>(`/tickets/${ticketId}/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteNote(ticketId: number, noteId: number) {
  return request<void>(`/tickets/${ticketId}/notes/${noteId}`, { method: 'DELETE' });
}

// ─── Connections (shared external account credentials) ────────────────────────
//
// A Connection is one Jira site or ConnectWise instance. Secrets never come
// back over the API — `config` collapses them to `hasX` booleans, mirroring
// how /integrations handles secret fields.

export type ConnectionType = "jira";

export interface Connection {
  id: number;
  name: string;
  type: ConnectionType;
  enabled: boolean;
  config: Record<string, unknown>;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  /** Every required credential field is present (secrets included) — not just
   *  the visible ones. A connection can be "configured" and still fail Test. */
  configured: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  category: string;
  message: string;
  identity?: string;
  testedAt: string;
}

export function listConnections(type?: ConnectionType) {
  const params = type ? `?type=${encodeURIComponent(type)}` : "";
  return request<Connection[]>(`/connections${params}`);
}

export function createConnection(data: { name: string; type: ConnectionType; config?: Record<string, unknown>; enabled?: boolean }) {
  return request<Connection>("/connections", { method: "POST", body: JSON.stringify(data) });
}

export function updateConnection(id: number, data: { name?: string; config?: Record<string, unknown>; enabled?: boolean }) {
  return request<Connection>(`/connections/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteConnection(id: number) {
  return request<void>(`/connections/${id}`, { method: "DELETE" });
}

/** Non-mutating credential test against the stored config. Persists on the
 *  connection so the result survives a page reload. */
export function testConnection(id: number) {
  return request<ConnectionTestResult>(`/connections/${id}/test`, { method: "POST" });
}

// ─── Sync jobs ──────────────────────────────────────────────────────────────
//
// A sync job (`SyncProvider` row) pairs a provider type with a small
// type-specific scope. Jira jobs require one explicit Connection; ConnectWise
// remains on one legacy-global account record and therefore carries null, but
// every job must name its exact board.
// `config` here is already the safe DTO the backend returns — only the fields
// this job's type recognizes.

export interface SyncProvider {
  id: number;
  name: string;
  type: "connectwise" | "jira";
  enabled: boolean;
  lastSyncedAt: string | null;
  configRevision: number;
  createdAt?: string;
  connectionId: number | null;
  health: SyncHealthSummary;
  config: {
    projectKey?: string;
    jql?: string;
    board?: string;
    filter?: SyncFilterInput;
  };
}

export type SyncRunStatus = "running" | "success" | "degraded" | "error";
export type SyncHealthStatus = "never_run" | "running" | "healthy" | "degraded" | "failing";

export interface SyncRunSummary {
  id: number;
  providerId: number;
  configRevision: number;
  provider?: { name: string; type: string };
  trigger: "manual" | "scheduled";
  status: SyncRunStatus;
  initiatedBy: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  ticketsCreated: number;
  ticketsUpdated: number;
  notesUpserted: number;
  ticketsFiltered: number;
  ticketsSkipped: number;
  ticketsConflicted: number;
  errorCount: number;
  latestError: string | null;
}

export interface SyncHealthSummary {
  status: SyncHealthStatus;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  latestError: string | null;
  latestRun: SyncRunSummary | null;
}

/** Provider-neutral filter vocabulary — mirrors backend/src/services/syncFilter.ts.
 *  Values within a field are OR'd, fields are AND'd, exclude wins. */
export interface SyncFilterInput {
  assignee?: string[];
  status?: string[];
  priority?: string[];
  companyName?: string[];
  exclude?: {
    assignee?: string[];
    status?: string[];
    priority?: string[];
    companyName?: string[];
  };
}

export function listSyncProviders() {
  return request<SyncProvider[]>('/sync/providers');
}

interface SyncProviderCreateBase {
  name: string;
  enabled?: boolean;
}

export type CreateSyncProviderInput =
  | (SyncProviderCreateBase & {
      type: "jira";
      /** Required tenant binding; generic job creation must make the admin choose it. */
      connectionId: number;
      config?: { projectKey?: string; jql?: string; filter?: SyncFilterInput | null };
    })
  | (SyncProviderCreateBase & {
      type: "connectwise";
      /** ConnectWise is still one global account, but its job scope is explicit. */
      connectionId?: null;
      config: { board: string; filter?: SyncFilterInput | null };
    });

export function createSyncProvider(data: CreateSyncProviderInput) {
  return request<SyncProvider>('/sync/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateSyncProvider(
  providerId: number,
  data: {
    name?: string;
    enabled?: boolean;
    /** Jira may change to another explicit id; null is only valid for ConnectWise. */
    connectionId?: number | null;
    config?: { projectKey?: string; jql?: string; board?: string; filter?: SyncFilterInput | null };
  }
) {
  return request<SyncProvider>(`/sync/providers/${providerId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Two-way ticket sync ───────────────────────────────────────────────────────

export interface ReconcileResult {
  ticketId: number;
  outcome: "synced" | "pushed" | "pulled" | "conflict" | "error" | "skipped";
  message?: string;
}

/** Reconcile an external ticket with its source now (pull / push / flag conflict). */
export function syncTicket(id: number) {
  return request<ReconcileResult>(`/tickets/${id}/sync`, { method: "POST" });
}

/** Resolve a held conflict by choosing the winning side. */
export function resolveTicketConflict(id: number, resolution: "local" | "remote") {
  return request<ReconcileResult>(`/tickets/${id}/resolve-conflict`, {
    method: "POST",
    body: JSON.stringify({ resolution }),
  });
}

export interface SyncRunResult {
  runId: number | null;
  providerId: number;
  providerName: string;
  status: Exclude<SyncRunStatus, "running">;
  ticketsCreated: number;
  ticketsUpdated: number;
  notesUpserted: number;
  ticketsFiltered: number;
  ticketsSkipped: number;
  ticketsConflicted: number;
  errorCount: number;
  errors: string[];
  durationMs: number;
}

/** Runs one job (`provider` = job name) or every enabled job. The backend
 *  returns a single result for one job, an array for "all". */
export function runSync(provider?: string) {
  const params = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return request<SyncRunResult | SyncRunResult[]>(`/sync/run${params}`, { method: 'POST' });
}

export interface SyncLogEntry {
  id: number;
  runId: number | null;
  externalId: string | null;
  internalId: number | null;
  direction: "inbound" | "outbound";
  status: "success" | "error" | "skipped";
  message: string | null;
  syncedAt: string;
  provider: { name: string; type: string };
}

export function getSyncLog(opts: { provider?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.provider) params.set('provider', opts.provider);
  if (opts.limit) params.set('limit', String(opts.limit));
  return request<SyncLogEntry[]>(`/sync/log?${params}`);
}

export function listSyncRuns(opts: { provider?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.provider) params.set("provider", opts.provider);
  if (opts.limit) params.set("limit", String(opts.limit));
  return request<SyncRunSummary[]>(`/sync/runs?${params}`);
}

export interface SyncRunDetail extends SyncRunSummary {
  provider: { name: string; type: string };
  logCount: number;
  logsTruncated: boolean;
  logs: SyncLogEntry[];
}

export function getSyncRun(runId: number) {
  return request<SyncRunDetail>(`/sync/runs/${runId}`);
}

export function deleteSyncProvider(providerId: number) {
  return request<void>(`/sync/providers/${providerId}`, { method: 'DELETE' });
}

// ─── Devices ──────────────────────────────────────────────────────────────────

export interface DeviceFilters {
  company?: string;
  source?: string;
  status?: string;
  probeId?: number;
  page?: number;
  pageSize?: number;
}

export interface DeviceExternalRef {
  id: number;
  deviceId: number;
  provider: string;
  externalId: string;
  metadata?: Record<string, unknown> | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: number;
  hostname: string | null;
  displayName: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  vendor: string | null;
  os: string | null;
  deviceType: string | null;
  status: string;
  companyName: string | null;
  companyId: number | null;
  source: string;
  probeId: number | null;
  externalId: string | null;
  externalProvider: string | null;
  assetTag: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  purchaseDate: string | null;
  warrantyExpiresAt: string | null;
  notes: string | null;
  metadata?: Record<string, unknown> | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  externalRefs: DeviceExternalRef[];
}

export function listDevices(filters: DeviceFilters = {}) {
  const params = new URLSearchParams(
    Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )
  );
  return request<Device[]>(`/devices?${params}`);
}

export function getDevice(id: number) {
  return request<Device>(`/devices/${id}`);
}

/** Live snapshot pulled from whichever RMM owns the device. Fields beyond the
 *  common core are optional — not every RMM reports them. */
export interface RmmLiveData {
  provider: "tactical_rmm" | "ninjaone" | "datto_rmm";
  fetchedAt: string;
  externalId: string;
  hostname: string | null;
  status: string;
  operatingSystem: string | null;
  platform: string | null;
  localIps: string[];
  publicIp: string | null;
  siteName?: string | null;
  lastSeen: string | null;
  clientName?: string | null;
  monitoringType?: string | null;
  makeModel?: string | null;
  serialNumber?: string | null;
  cpuModel?: string | null;
}

/** @deprecated use RmmLiveData — kept as an alias so existing imports compile. */
export type TacticalLiveData = RmmLiveData;

export function getDeviceLive(id: number, provider?: string) {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return request<RmmLiveData>(`/devices/${id}/live${query}`);
}

export function createDevice(data: Partial<Device>) {
  return request<Device>('/devices', { method: 'POST', body: JSON.stringify(data) });
}

export function updateDevice(id: number, data: Partial<Device>) {
  return request<Device>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteDevice(id: number) {
  return request<void>(`/devices/${id}`, { method: 'DELETE' });
}

export function listDeviceExternalRefs(deviceId: number) {
  return request<DeviceExternalRef[]>(`/devices/${deviceId}/external-refs`);
}

export function addDeviceExternalRef(
  deviceId: number,
  data: { provider: string; externalId: string; metadata?: Record<string, unknown> }
) {
  return request<DeviceExternalRef>(`/devices/${deviceId}/external-refs`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteDeviceExternalRef(deviceId: number, refId: number) {
  return request<void>(`/devices/${deviceId}/external-refs/${refId}`, { method: "DELETE" });
}

export function listTicketDevices(ticketId: number) {
  return request<Device[]>(`/tickets/${ticketId}/devices`);
}

export function linkDevice(ticketId: number, deviceId: number) {
  return request<unknown>(`/tickets/${ticketId}/devices`, {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}

export function unlinkDevice(ticketId: number, deviceId: number) {
  return request<void>(`/tickets/${ticketId}/devices/${deviceId}`, { method: 'DELETE' });
}

// ─── Probes ───────────────────────────────────────────────────────────────────

export function listProbes() {
  return request<unknown[]>('/probes');
}

/** Returns the created probe INCLUDING its apiKey (shown once). */
export function createProbe(data: { name: string; kind?: string; companyName?: string; companyId?: number | null; cidr?: string }) {
  return request<{ id: number; name: string; apiKey: string }>('/probes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProbe(id: number, data: { name?: string; companyName?: string; companyId?: number | null; cidr?: string }) {
  return request<unknown>(`/probes/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteProbe(id: number) {
  return request<void>(`/probes/${id}`, { method: 'DELETE' });
}

// ─── Mail ─────────────────────────────────────────────────────────────────────

export function getMailStatus() {
  return request<{ configured: boolean; from: string; host: string | null; port: number; secure: boolean }>(
    '/mail/status'
  );
}

export function sendTicketEmail(
  ticketId: number,
  data: {
    to: string | string[]; subject: string; text?: string; html?: string;
    cc?: string[]; bcc?: string[]; attachmentIds?: number[];
    fromIdentityId?: number; includeSignature?: boolean;
  }
) {
  return request<{ ok: boolean; messageId: string }>(`/tickets/${ticketId}/email`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Mail identities, templates, signature ──────────────────────────────────────

export interface MailIdentity {
  id: number;
  address: string;
  displayName: string | null;
  shared: boolean;
  userId: number | null;
  enabled: boolean;
}

/** Identities the current user may send as (shared + own aliases). */
export function listMyMailIdentities() {
  return request<MailIdentity[]>("/mail/identities");
}
export function listAllMailIdentities() {
  return request<MailIdentity[]>("/mail/identities/all");
}
export function createMailIdentity(data: Partial<MailIdentity>) {
  return request<MailIdentity>("/mail/identities", { method: "POST", body: JSON.stringify(data) });
}
export function updateMailIdentity(id: number, data: Partial<MailIdentity>) {
  return request<MailIdentity>(`/mail/identities/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteMailIdentity(id: number) {
  return request<void>(`/mail/identities/${id}`, { method: "DELETE" });
}

export interface MailTemplate {
  id: number;
  name: string;
  subject: string | null;
  bodyHtml: string;
}
export function listMailTemplates() {
  return request<MailTemplate[]>("/mail/templates");
}
export function createMailTemplate(data: Partial<MailTemplate>) {
  return request<MailTemplate>("/mail/templates", { method: "POST", body: JSON.stringify(data) });
}
export function updateMailTemplate(id: number, data: Partial<MailTemplate>) {
  return request<MailTemplate>(`/mail/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteMailTemplate(id: number) {
  return request<void>(`/mail/templates/${id}`, { method: "DELETE" });
}

export function getMySignature() {
  return request<{ signatureHtml: string }>("/auth/signature");
}
export function setMySignature(signatureHtml: string) {
  return request<{ signatureHtml: string }>("/auth/signature", { method: "PUT", body: JSON.stringify({ signatureHtml }) });
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export interface Label {
  id: number;
  name: string;
  color: string;
}
export function listLabels() {
  return request<Label[]>("/labels");
}
export function createLabel(data: Partial<Label>) {
  return request<Label>("/labels", { method: "POST", body: JSON.stringify(data) });
}
export function updateLabel(id: number, data: Partial<Label>) {
  return request<Label>(`/labels/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteLabel(id: number) {
  return request<void>(`/labels/${id}`, { method: "DELETE" });
}
export function tagTicket(ticketId: number, labelId: number) {
  return request<{ ok: boolean }>(`/tickets/${ticketId}/labels`, { method: "POST", body: JSON.stringify({ labelId }) });
}
export function untagTicket(ticketId: number, labelId: number) {
  return request<void>(`/tickets/${ticketId}/labels/${labelId}`, { method: "DELETE" });
}

/** URL for the printable ticket export (cookie-authed; open in a new tab). */
export function ticketExportUrl(ticketId: number): string {
  return `/api/tickets/${ticketId}/export`;
}

// ─── Attachments ───────────────────────────────────────────────────────────────

export interface Attachment {
  id: number;
  ticketId: number;
  noteId: number | null;
  filename: string;
  contentType: string;
  size: number;
  storageBackend: string;
  createdBy: string | null;
  createdAt: string;
}

export function listAttachments(ticketId: number) {
  return request<Attachment[]>(`/tickets/${ticketId}/attachments`);
}

/** Upload one or more files to a ticket via multipart/form-data. */
export async function uploadAttachments(ticketId: number, files: File[]): Promise<Attachment[]> {
  const form = new FormData();
  for (const f of files) form.append("file", f, f.name);
  const headers: Record<string, string> = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: form, // browser sets the multipart boundary Content-Type
    headers,
    credentials: "same-origin",
  });
  if (!res.ok) throw new ApiError(res.status, await res.text(), `Upload failed (${res.status})`);
  return res.json() as Promise<Attachment[]>;
}

/** URL the browser can hit directly to download an attachment (cookie auth). */
export function attachmentDownloadUrl(id: number): string {
  return `/api/attachments/${id}/download`;
}

export function deleteAttachment(id: number) {
  return request<void>(`/attachments/${id}`, { method: "DELETE" });
}

// ─── Notifications ─────────────────────────────────────────────────────────────

export interface NotificationItem {
  id: number;
  type: string;
  ticketId: number | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export function listNotifications(unreadOnly = false) {
  return request<{ items: NotificationItem[]; unread: number }>(
    `/notifications?unreadOnly=${unreadOnly}`
  );
}

export function markNotificationRead(id: number) {
  return request<{ unread: number }>(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return request<{ unread: number }>(`/notifications/read-all`, { method: "POST" });
}

// ─── SLA policies ──────────────────────────────────────────────────────────────

export interface SlaPolicy {
  id: number;
  name: string;
  priority: string | null;
  companyId: number | null;
  responseMinutes: number;
  resolutionMinutes: number;
  enabled: boolean;
}

export function listSlaPolicies() {
  return request<SlaPolicy[]>("/sla/policies");
}
export function createSlaPolicy(data: Partial<SlaPolicy>) {
  return request<SlaPolicy>("/sla/policies", { method: "POST", body: JSON.stringify(data) });
}
export function updateSlaPolicy(id: number, data: Partial<SlaPolicy>) {
  return request<SlaPolicy>(`/sla/policies/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteSlaPolicy(id: number) {
  return request<void>(`/sla/policies/${id}`, { method: "DELETE" });
}

// ─── RMM / scripts ─────────────────────────────────────────────────────────────

export interface RmmProviderStatus {
  key: "tactical_rmm" | "ninjaone" | "datto_rmm";
  label: string;
  configured: boolean;
  hasScriptCatalog: boolean;
}

export function getRmmStatus() {
  return request<{ providers: RmmProviderStatus[]; tactical: { configured: boolean } }>('/rmm/status');
}

/** Script catalog for a given RMM. Providers without a catalog (Datto) return []. */
export function listScripts(provider?: string) {
  const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return request<{ id: string; name: string; shell?: string }[]>(`/scripts${qs}`);
}

/** Pull devices from an RMM; `provider` defaults server-side to Tactical. */
export function syncDevices(provider?: string) {
  const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return request<{ provider: string; created: number; updated: number; errors: string[] }>(`/devices/sync${qs}`, {
    method: 'POST',
  });
}

export function runDeviceScript(
  deviceId: number,
  data: { script: string | number; scriptName?: string; args?: string[]; timeout?: number; ticketId?: number; scheduledFor?: string; provider?: string }
) {
  return request<unknown>(`/devices/${deviceId}/run-script`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listDeviceScriptJobs(deviceId: number) {
  return request<unknown[]>(`/devices/${deviceId}/script-jobs`);
}

export function listTicketScriptJobs(ticketId: number) {
  return request<unknown[]>(`/tickets/${ticketId}/script-jobs`);
}

export function getScriptJob(id: number) {
  return request<unknown>(`/script-jobs/${id}`);
}

// ─── Time / My Day ───────────────────────────────────────────────────────────

export interface MyDayEntry {
  id: number;
  ticketId: number;
  ticketNumber: string | null;
  ticketTitle: string | null;
  content: string;
  minutes: number;
  timeStart: string | null;
  timeStop: string | null;
  workedAt: string;
  /** True when the entry has a start+stop window and can sit on the clock. */
  placed: boolean;
}

export interface MyDay {
  from: string;
  to: string;
  entries: MyDayEntry[];
  summary: {
    loggedMinutes: number;
    placedMinutes: number;
    unplacedMinutes: number;
    firstStart: string | null;
    lastStop: string | null;
    count: number;
  };
}

/** The signed-in user's logged time for a single day. `from`/`to` are the
 *  client's local day bounds so the day matches the tech's timezone. */
export function getMyDay(from: Date, to: Date) {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return request<MyDay>(`/me/time-entries?${params}`);
}

// ─── Reports (2.7.0) ─────────────────────────────────────────────────────────

export interface ReportFilters {
  /** Inclusive UTC instant. */
  from: string;
  /** Exclusive UTC instant. */
  to: string;
  companyId?: number;
  teamId?: number;
  assigneeId?: number;
}

export interface ReportMeta {
  from: string;
  to: string;
  includesReconstructed: boolean;
  reconstructedFrom: string | null;
  reconstructedThrough: string | null;
}

export interface ReportResponse<T, M extends ReportMeta = ReportMeta> {
  data: T;
  meta: M;
}

export interface VolumeBucket {
  day: string;
  created: number;
  resolved: number;
}

export interface DurationMetric {
  count: number;
  p50Minutes: number | null;
  p90Minutes: number | null;
}

export interface DurationPercentiles {
  firstResponse: DurationMetric;
  resolution: DurationMetric;
}

export interface SlaComplianceRow {
  kind: "response" | "resolution";
  met: number;
  breached: number;
  atRisk: number;
  onTrack: number;
}

export interface SlaComplianceMeta extends ReportMeta {
  slaSnapshotCoverageFrom: string | null;
  includesUnrecordedSlaHistory: boolean;
}

export interface BacklogAgeBucket {
  bucket: "<1d" | "1-3d" | "3-7d" | "7-30d" | "30d+";
  count: number;
}

export interface TeamThroughput {
  teamId: number | null;
  teamName: string | null;
  resolved: number;
}

export interface FeedbackBreakdown {
  companyId: number | null;
  companyName: string | null;
  positive: number;
  neutral: number;
  negative: number;
}

export interface AssigneeThroughput {
  assigneeId: number | null;
  assigneeName: string | null;
  resolved: number;
}

export interface CompanyTimeLogged {
  companyId: number | null;
  companyName: string | null;
  minutes: number;
}

export interface TimeDaySpreadData {
  assigneeId: number;
  entries: MyDayEntry[];
  target: {
    minutes: number;
    source: "default_8h";
    label: string;
  };
  summary: {
    count: number;
    loggedMinutes: number;
    placedMinutes: number;
    coveredMinutes: number;
    unplacedMinutes: number;
    unloggedMinutes: number;
    uncoveredMinutes: number;
    firstStart: string | null;
    lastStop: string | null;
  };
}

export type TimeDaySpreadResponse = ReportResponse<TimeDaySpreadData>;

export type TicketTimelineEventKind =
  | "created"
  | "status_changed"
  | "assigned"
  | "context_changed"
  | "first_response"
  | "resolved"
  | "reopened"
  | "merged"
  | "sla_breached";

export interface TicketSlaTimelineEvent {
  id: string;
  kind: TicketTimelineEventKind;
  fromValue: string | null;
  toValue: string | null;
  actor: string | null;
  companyId: number | null;
  teamId: number | null;
  assigneeId: number | null;
  priority: string | null;
  occurredAt: string;
  sourceAuditId: string | null;
}

export interface TicketSlaTimelineTarget {
  id: string;
  policyId: number | null;
  policyName: string | null;
  responseMinutes: number | null;
  resolutionMinutes: number | null;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  establishedAt: string;
  supersededAt: string | null;
}

export interface TicketSlaTimelineData {
  ticket: {
    id: number;
    ticketNumber: string | null;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  events: TicketSlaTimelineEvent[];
  targets: TicketSlaTimelineTarget[];
}

export interface TicketSlaTimelineMeta extends ReportMeta {
  rangeDerived: boolean;
}

export type TicketSlaTimelineResponse =
  ReportResponse<TicketSlaTimelineData, TicketSlaTimelineMeta>;

function reportQuery(filters: ReportFilters): string {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
  });
  if (filters.companyId !== undefined) params.set("companyId", String(filters.companyId));
  if (filters.teamId !== undefined) params.set("teamId", String(filters.teamId));
  if (filters.assigneeId !== undefined) params.set("assigneeId", String(filters.assigneeId));
  return params.toString();
}

export function getVolumeReport(filters: ReportFilters) {
  return request<ReportResponse<VolumeBucket[]>>(`/reports/volume?${reportQuery(filters)}`);
}

export function getDurationReport(filters: ReportFilters) {
  return request<ReportResponse<DurationPercentiles>>(`/reports/durations?${reportQuery(filters)}`);
}

export function getSlaComplianceReport(filters: ReportFilters) {
  return request<ReportResponse<SlaComplianceRow[], SlaComplianceMeta>>(
    `/reports/sla-compliance?${reportQuery(filters)}`
  );
}

export function getBacklogAgeReport(filters: ReportFilters) {
  return request<ReportResponse<BacklogAgeBucket[]>>(`/reports/backlog-age?${reportQuery(filters)}`);
}

export function getTeamThroughputReport(filters: ReportFilters) {
  return request<ReportResponse<TeamThroughput[]>>(
    `/reports/throughput/team?${reportQuery(filters)}`
  );
}

export function getFeedbackReport(filters: ReportFilters) {
  return request<ReportResponse<FeedbackBreakdown[]>>(
    `/reports/feedback?${reportQuery(filters)}`
  );
}

export function getAssigneeThroughputReport(filters: ReportFilters) {
  return request<ReportResponse<AssigneeThroughput[]>>(
    `/reports/throughput/assignee?${reportQuery(filters)}`
  );
}

export function getTimeByCompanyReport(filters: ReportFilters) {
  return request<ReportResponse<CompanyTimeLogged[]>>(
    `/reports/time-by-company?${reportQuery(filters)}`
  );
}

export function downloadTimeByCompanyCsv(filters: ReportFilters) {
  return requestBlob(`/reports/time-by-company.csv?${reportQuery(filters)}`);
}

export function getTimeDaySpread(from: Date, to: Date, assigneeId: number) {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    assigneeId: String(assigneeId),
  });
  return request<TimeDaySpreadResponse>(`/time/day-spread?${params}`);
}

export function getTicketSlaTimeline(ticketId: number) {
  return request<TicketSlaTimelineResponse>(`/tickets/${ticketId}/sla-timeline`);
}

// ---- Checklists (2.4.0) ----------------------------------------------------

export interface ChecklistTemplateItem {
  id: number;
  templateId: number;
  text: string;
  sortOrder: number;
  /** Relative deadline: item dueAt = apply time + offset. Null = none. */
  dueOffsetMinutes: number | null;
}
export interface ChecklistTemplate {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  items: ChecklistTemplateItem[];
}
export interface ChecklistItem {
  id: number;
  ticketId: number;
  text: string;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
  /** Independent per-item deadline; never feeds the ticket SLA clocks. */
  dueAt: string | null;
  sortOrder: number;
  templateId: number | null;
}
export interface ChecklistTemplateInput {
  name: string;
  description?: string | null;
  active?: boolean;
  items?: { text: string; dueOffsetMinutes?: number | null }[];
}

export function listChecklistTemplates(includeInactive = false) {
  return request<ChecklistTemplate[]>(`/checklist-templates${includeInactive ? "?includeInactive=true" : ""}`);
}
export function createChecklistTemplate(data: ChecklistTemplateInput) {
  return request<ChecklistTemplate>("/checklist-templates", { method: "POST", body: JSON.stringify(data) });
}
export function updateChecklistTemplate(id: number, data: Partial<ChecklistTemplateInput>) {
  return request<ChecklistTemplate>(`/checklist-templates/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteChecklistTemplate(id: number) {
  return request<void>(`/checklist-templates/${id}`, { method: "DELETE" });
}
export function listChecklist(ticketId: number) {
  return request<ChecklistItem[]>(`/tickets/${ticketId}/checklist`);
}
export function addChecklistItem(ticketId: number, data: { text: string; dueAt?: string | null }) {
  return request<ChecklistItem>(`/tickets/${ticketId}/checklist`, { method: "POST", body: JSON.stringify(data) });
}
export function updateChecklistItem(
  ticketId: number,
  itemId: number,
  data: { text?: string; done?: boolean; dueAt?: string | null; sortOrder?: number }
) {
  return request<ChecklistItem>(`/tickets/${ticketId}/checklist/${itemId}`, { method: "PATCH", body: JSON.stringify(data) });
}
export function deleteChecklistItem(ticketId: number, itemId: number) {
  return request<void>(`/tickets/${ticketId}/checklist/${itemId}`, { method: "DELETE" });
}
export function applyChecklistTemplate(ticketId: number, templateId: number) {
  return request<ChecklistItem[]>(`/tickets/${ticketId}/checklist/apply-template`, {
    method: "POST",
    body: JSON.stringify({ templateId }),
  });
}

// ---- Knowledge base (2.7.0) -------------------------------------------------

export type KbVisibility = "internal" | "portal";

export interface KbArticle {
  id: number;
  slug: string;
  title: string;
  bodyHtml: string;
  category: string;
  visibility: KbVisibility;
  published: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbArticleSummary {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  visibility: KbVisibility;
  published: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbSearchItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface KbArticleInput {
  title: string;
  bodyHtml: string;
  category: string;
  visibility: KbVisibility;
  published: boolean;
}

export function searchKbArticles(options: {
  q: string;
  visibility?: KbVisibility;
  limit?: number;
}) {
  const params = new URLSearchParams({ q: options.q });
  if (options.visibility) params.set("visibility", options.visibility);
  if (options.limit != null) params.set("limit", String(options.limit));
  return request<{ items: KbSearchItem[] }>(`/kb/search?${params}`);
}

export function listKbArticles(options: {
  includeUnpublished?: boolean;
  /** Narrows the author listing; requires includeUnpublished. */
  published?: boolean;
  visibility?: KbVisibility;
} = {}) {
  const params = new URLSearchParams();
  if (options.includeUnpublished) params.set("includeUnpublished", "true");
  if (options.published !== undefined) params.set("published", String(options.published));
  if (options.visibility) params.set("visibility", options.visibility);
  const query = params.toString();
  return request<{ items: KbArticleSummary[] }>(`/kb/articles${query ? `?${query}` : ""}`);
}

export function getKbArticle(id: number) {
  return request<KbArticle>(`/kb/articles/${id}`);
}

export function createKbArticle(data: KbArticleInput) {
  return request<KbArticle>("/kb/articles", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateKbArticle(id: number, data: Partial<KbArticleInput>) {
  return request<KbArticle>(`/kb/articles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteKbArticle(id: number) {
  return request<void>(`/kb/articles/${id}`, { method: "DELETE" });
}

export interface AutomationPreview {
  sampled: number;
  sinceDays: number;
  matched: number;
  usesEventFields: boolean;
  sample: { id: number; ticketNumber: string | null; title: string; status: string; priority: string | null }[];
}
/** Dry-run a condition set against recent tickets (admin). */
export function previewAutomation(conditions: unknown[]) {
  return request<AutomationPreview>("/automations/preview", { method: "POST", body: JSON.stringify({ conditions }) });
}

/** First-run: does the instance still need its initial admin? */
export function getSetupStatus() {
  return request<{ needed: boolean }>("/auth/setup-status");
}
/** First-run: create the initial admin (only works while no users exist). */
export function runFirstRunSetup(data: { username: string; password: string; displayName?: string; email?: string }) {
  return request<{ ok: boolean; username: string }>("/auth/setup", { method: "POST", body: JSON.stringify(data) });
}
