# AnchorDesk 1.9.1 — Thread & Signal (patch)

A small follow-up to 1.9.0 that hardens inbound email threading and makes admin
ownership configurable for SSO deployments.

## Fixed

- **Subject threading false-positive.** Inbound email re-threading now matches
  only the bracketed `[#NNNNN]` token AnchorDesk emits on outbound mail. The
  previous bare `#NNNNN` fallback could re-attach an unrelated message
  ("Invoice #10042", "PO #12345") onto an existing ticket; that fallback has
  been removed. RFC `References`/`In-Reply-To` threading is unaffected.

## Added

- **`AUTH_ADMIN_EMAILS` allowlist.** A comma-separated list of emails that are
  granted the admin role on every OIDC/SAML login. Promotion-only — a user not
  on the list is never demoted, and existing local-role assignments are left
  alone. Useful when the IdP owns identity but you still need a known owner to
  be admin without a manual database edit.

## Upgrade notes

- No schema changes; this is a drop-in upgrade from 1.9.0.
- To use the allowlist, set `AUTH_ADMIN_EMAILS` (e.g. `you@example.com`) on the
  backend and re-login via SSO; the matching account is promoted on next sign-in.

## Validation

- Backend: 58 tests passed; TypeScript build passed.
- Web: 3 tests passed; TypeScript and Vite production build passed.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.9.1`
- `ghcr.io/spilloid/anchordesk-web-client:1.9.1`
