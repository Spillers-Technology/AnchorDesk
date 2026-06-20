/**
 * Thin API client for materialticket backend.
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

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: "admin" | "technician" | "readonly";
  authProvider: string;
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

export interface IntegrationsView {
  smtp: { host?: string; port?: number; secure?: boolean; user?: string; from?: string; hasPass?: boolean };
  connectwise: { server?: string; company?: string; publicKey?: string; hasPrivateKey?: boolean; hasClientId?: boolean };
  tactical: { apiUrl?: string; hasApiKey?: boolean };
}

export function getIntegrations() {
  return request<IntegrationsView>("/integrations");
}

export function updateIntegration(key: "smtp" | "connectwise" | "tactical", data: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/integrations/${key}`, { method: "PATCH", body: JSON.stringify(data) });
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
  page?: number;
  pageSize?: number;
}

export function listTickets(filters: TicketFilters = {}) {
  const params = new URLSearchParams(
    Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )
  );
  return request<unknown[]>(`/tickets?${params}`);
}

export function getTicket(id: number) {
  return request<unknown>(`/tickets/${id}`);
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

export function createNote(ticketId: number, data: Record<string, unknown>) {
  return request<unknown>(`/tickets/${ticketId}/notes`, { method: 'POST', body: JSON.stringify(data) });
}

export function updateNote(ticketId: number, noteId: number, data: Record<string, unknown>) {
  return request<unknown>(`/tickets/${ticketId}/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteNote(ticketId: number, noteId: number) {
  return request<void>(`/tickets/${ticketId}/notes/${noteId}`, { method: 'DELETE' });
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export function listSyncProviders() {
  return request<unknown[]>('/sync/providers');
}

export function runSync(provider?: string) {
  const params = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return request<unknown>(`/sync/run${params}`, { method: 'POST' });
}

export function getSyncLog(opts: { provider?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.provider) params.set('provider', opts.provider);
  if (opts.limit) params.set('limit', String(opts.limit));
  return request<unknown[]>(`/sync/log?${params}`);
}

export function toggleSyncProvider(providerId: number, enabled: boolean) {
  return request<unknown>(`/sync/providers/${providerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
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

export function listDevices(filters: DeviceFilters = {}) {
  const params = new URLSearchParams(
    Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    )
  );
  return request<unknown[]>(`/devices?${params}`);
}

export function getDevice(id: number) {
  return request<unknown>(`/devices/${id}`);
}

export function createDevice(data: Record<string, unknown>) {
  return request<unknown>('/devices', { method: 'POST', body: JSON.stringify(data) });
}

export function updateDevice(id: number, data: Record<string, unknown>) {
  return request<unknown>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteDevice(id: number) {
  return request<void>(`/devices/${id}`, { method: 'DELETE' });
}

export function listTicketDevices(ticketId: number) {
  return request<unknown[]>(`/tickets/${ticketId}/devices`);
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
export function createProbe(data: { name: string; kind?: string; companyName?: string; cidr?: string }) {
  return request<{ id: number; name: string; apiKey: string }>('/probes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
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
  data: { to: string | string[]; subject: string; text?: string; html?: string; cc?: string[] }
) {
  return request<{ ok: boolean; messageId: string }>(`/tickets/${ticketId}/email`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── RMM / scripts ─────────────────────────────────────────────────────────────

export function getRmmStatus() {
  return request<{ tactical: { configured: boolean } }>('/rmm/status');
}

export function listScripts() {
  return request<{ id: number; name: string; shell?: string }[]>('/scripts');
}

export function syncDevices() {
  return request<{ provider: string; created: number; updated: number; errors: string[] }>('/devices/sync', {
    method: 'POST',
  });
}

export function runDeviceScript(
  deviceId: number,
  data: { script: string | number; scriptName?: string; args?: string[]; timeout?: number; ticketId?: number; scheduledFor?: string }
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
