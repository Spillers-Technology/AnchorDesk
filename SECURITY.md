# Security policy

AnchorDesk holds the keys to other systems — RMM API credentials, PSA tokens,
mailbox passwords — so a vulnerability here can reach well past a ticket queue.
Reports are taken seriously and handled by the person who wrote the code.

## Supported versions

| Version | Security fixes |
|---|---|
| 2.8.x (latest patch) | Yes |
| Anything older | No — upgrade to the latest 2.8.x first ([docs/upgrading.md](docs/upgrading.md)) |

Fixes ship as a new patch release on the current minor line. There is no
long-term-support branch.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security problem.**

Email **[help@spillerstech.us](mailto:help@spillerstech.us?subject=SECURITY%3A%20AnchorDesk)**
with a subject starting `SECURITY: AnchorDesk`. Please include:

- the AnchorDesk version (Admin → overview, or the image tag you run) and how it
  is deployed (Compose, Kubernetes, other);
- what an attacker needs first (unauthenticated, portal requester, technician,
  admin, a probe key, a personal access token);
- steps to reproduce, and what they can read, change, or reach as a result.

Please do not test against an AnchorDesk instance you do not own or operate.

## What to expect

AnchorDesk is maintained by a one-person studio, so these are honest targets
rather than an SLA:

- **Acknowledgement** within 5 business days.
- **An assessment** — confirmed, not reproducible, or out of scope — with a
  proposed fix-and-disclosure timeline once it is reproduced.
- **Coordinated disclosure.** The default is to publish once a fixed release is
  available, and no later than 90 days after the report unless we agree
  otherwise. The release notes describe the issue and its impact.
- **Credit** in the release notes if you want it.

## Scope

In scope: this repository's backend, web client, customer portal, MCP server
and built-in OAuth authorization server, the probe ingest API, and the images
published to `ghcr.io/spillers-technology/anchordesk-*`.

Out of scope: vulnerabilities in third-party services AnchorDesk connects to
(report those to the vendor); deployments running with `OIDC_DISABLED=true`,
which disables authentication by design and is for local development only;
volumetric denial of service.

## Known limitations

These are documented, not hidden, and worth knowing before you deploy:

- **Integration credentials are stored in plaintext in PostgreSQL.** Only IMAP
  mailbox passwords are encrypted (AES-256-GCM with `ENCRYPTION_KEY`). Jira
  tokens, RMM API keys, and the SMTP password are readable by anyone with
  database access — treat the database and **every backup of it** as a secret
  ([docs/backup-restore.md](docs/backup-restore.md)).
- **Rate limiting is per process and in memory.** Login, OAuth, portal
  registration, and knowledge-base limits reset on restart and are not shared
  between backend replicas.
- **The backend does not configure Fastify's `trustProxy`.** Behind a reverse
  proxy, IP-based rate limits see the proxy's address rather than the client's.

## Security-relevant defaults

- TOTP MFA is required for local accounts unless `MFA_REQUIRED=false`.
- Secrets are write-only over the admin API; responses carry only `hasX` flags.
- The customer portal is off until an admin enables it, and a contact needs an
  explicit, audited grant to sign in.
- Staff notes are internal unless explicitly marked visible to the customer.
- Personal access tokens are stored as SHA-256 hashes, can only be minted from
  an interactive login, and are revocable by their owner or an admin.
