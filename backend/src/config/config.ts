import dotenv from 'dotenv';

dotenv.config();

export const config = {
  serverPort: process.env.SERVER_PORT || 8060,

  // Database (required)
  databaseUrl: process.env.DATABASE_URL || '',

  // AES key (hex) for encrypting stored secrets (mailbox passwords). 64 hex
  // chars = AES-256. Falls back to a dev key so local dev boots; set in prod.
  encryptionKey: process.env.ENCRYPTION_KEY || '0'.repeat(64),

  // Public base URL of the app — used to build OIDC/SAML callback URLs.
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),

  // Session cookie signing secret. Required in production; a dev fallback is
  // used when unset so local dev works out of the box (sessions reset on boot).
  sessionSecret: process.env.AUTH_SESSION_SECRET || 'dev-insecure-session-secret-change-me',

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
  mfaIssuer: process.env.MFA_ISSUER || 'MaterialTicket',

  // OIDC — works with Azure AD, Authentik, Okta, or any OIDC-compliant IdP.
  // These seed the AuthSetting row on first boot; the DB row wins afterward.
  oidcIssuerUrl: process.env.OIDC_ISSUER_URL || '',
  oidcClientId: process.env.OIDC_CLIENT_ID || '',
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || '',
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI || '',

  // SAML 2.0 SP config (env seed).
  saml: {
    entryPoint: process.env.SAML_ENTRY_POINT || '',
    issuer: process.env.SAML_ISSUER || 'materialticket',
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
    from: process.env.SMTP_FROM || 'materialticket@localhost',
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
};
