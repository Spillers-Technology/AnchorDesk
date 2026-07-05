import dotenv from 'dotenv';

dotenv.config();

function ticketNumberDigits(value: string | undefined): number {
  const parsed = Number(value ?? 5);
  return Number.isFinite(parsed) ? Math.min(6, Math.max(4, Math.trunc(parsed))) : 5;
}

// Comma/space/semicolon-separated list of email addresses that are always
// granted the admin role when they sign in via SSO (OIDC/SAML). Normalized to
// lowercase. Promotion-only: matching users are raised to admin on login but a
// non-matching user is never demoted.
function parseAdminEmails(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  serverPort: process.env.SERVER_PORT || 8060,

  // Database (required)
  databaseUrl: process.env.DATABASE_URL || '',

  // AES key (hex) for encrypting stored secrets (mailbox passwords). 64 hex
  // chars = AES-256. Falls back to a dev key so local dev boots; set in prod.
  encryptionKey: process.env.ENCRYPTION_KEY || '0'.repeat(64),

  // Public base URL of the app — used to build OIDC/SAML callback URLs.
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),

  // Human-friendly ticket numbers. Locally-created tickets draw from a Postgres
  // sequence starting at 10^(digits-1) (5 → 10000). Env seeds the `tickets`
  // settings row on first boot; the DB row wins and is editable in Admin.
  // Clamped to 4–6 to keep numbers intuitive.
  ticketNumberDigits: ticketNumberDigits(process.env.TICKET_NUMBER_DIGITS),

  // Session cookie signing secret. Required in production; a dev fallback is
  // used when unset so local dev works out of the box (sessions reset on boot).
  sessionSecret: process.env.AUTH_SESSION_SECRET || 'dev-insecure-session-secret-change-me',

  // SSO admin allowlist — emails here are always granted admin on SSO login
  // (promotion-only). Useful when the IdP owns identity but you still need a
  // known owner to be admin without a manual DB edit.
  adminEmails: parseAdminEmails(process.env.AUTH_ADMIN_EMAILS),

  // Bootstrap admin — only used to create the first local admin when the users
  // table is empty. No-op once any user exists.
  bootstrapAdmin: {
    username: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@localhost',
  },

  // Whether local username/password login is offered (env seed; DB can override).
  authLocalEnabled: process.env.AUTH_LOCAL_ENABLED !== 'false',

  // MFA (TOTP) policy. Enabled/required by default; set MFA_REQUIRED=false to make
  // TOTP optional for local accounts. mfaIssuer labels the entry in authenticator apps.
  mfaRequired: process.env.MFA_REQUIRED !== 'false',
  mfaIssuer: process.env.MFA_ISSUER || 'AnchorDesk',

  // OIDC — works with Azure AD, Authentik, Okta, or any OIDC-compliant IdP.
  // These seed the AuthSetting row on first boot; the DB row wins afterward.
  oidcIssuerUrl: process.env.OIDC_ISSUER_URL || '',
  oidcClientId: process.env.OIDC_CLIENT_ID || '',
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || '',
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI || '',

  // SAML 2.0 SP config (env seed).
  saml: {
    entryPoint: process.env.SAML_ENTRY_POINT || '',
    issuer: process.env.SAML_ISSUER || 'anchordesk',
    idpCert: process.env.SAML_IDP_CERT || '',
  },

  // Set to 'true' to skip auth entirely in local dev (every request = dev admin)
  oidcDisabled: process.env.OIDC_DISABLED === 'true',

  // SMTP relay (optional) — "the ticket talks to humans". Point at internal
  // Postfix or any provider. Mail features are disabled until host is set.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true = implicit TLS (465)
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'anchordesk@localhost',
    // Validate the relay's TLS certificate (STARTTLS on 587/25 or implicit TLS on
    // 465). On by default. Set SMTP_TLS_REJECT_UNAUTHORIZED=false for an internal
    // Postfix that presents a self-signed cert — otherwise the STARTTLS upgrade
    // fails with ESOCKET "self-signed certificate" and the send 502s.
    tlsRejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
  },

  // Attachment storage (1.7.0). backend = 'local' (disk) or 's3' (any
  // S3-compatible store: AWS, MinIO, Cloudflare R2, Backblaze B2). These seed the
  // `storage` settings row on first boot; the DB row wins and is editable in
  // Admin → Integrations. For S3-compatible providers set `endpoint` and usually
  // `forcePathStyle=true`.
  storage: {
    backend: (process.env.STORAGE_BACKEND || 'local') as 'local' | 's3',
    localDir: process.env.STORAGE_LOCAL_DIR || './data/attachments',
    s3Endpoint: process.env.S3_ENDPOINT || '',
    s3Region: process.env.S3_REGION || 'us-east-1',
    s3Bucket: process.env.S3_BUCKET || '',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  },

  // Tactical RMM (optional) — enables device sync + running scripts on devices.
  // apiUrl is the API base of your Tactical instance, e.g. https://api.rmm.example.com
  trmm: {
    apiUrl: (process.env.TRMM_API_URL || '').replace(/\/$/, ''),
    apiKey: process.env.TRMM_API_KEY || '',
  },

  // ConnectWise Manage (optional — only needed if CW sync is configured)
  cwm: {
    company: process.env.CWM_COMPANY || '',
    server: process.env.CWM_SERVER || '',
    publicKey: process.env.CWM_PUBKEY || '',
    privateKey: process.env.CWM_PRIVATEKEY || '',
    clientId: process.env.CWM_CLIENTID || '',
  },

  // Jira Cloud (optional — two-way ticket sync). baseUrl is the site, e.g.
  // https://your-org.atlassian.net. Auth is the account email + an API token
  // (id.atlassian.com > Security > API tokens). projectKey/jql scope which issues
  // sync; leave jql blank to use open issues in the project.
  jira: {
    baseUrl: (process.env.JIRA_BASE_URL || '').replace(/\/$/, ''),
    email: process.env.JIRA_EMAIL || '',
    apiToken: process.env.JIRA_API_TOKEN || '',
    projectKey: process.env.JIRA_PROJECT_KEY || '',
    jql: process.env.JIRA_JQL || '',
  },
};
