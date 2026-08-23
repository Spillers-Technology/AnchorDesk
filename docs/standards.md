# Company standards status

Reconciled 2026-08-25 against `corporate-strategy/standards/STD-001` through
`STD-008` and this branch. Re-verify these claims against the live repo when the
standards or implementation changes.

| Standard | Status | Evidence / reason |
|---|---|---|
| STD-001 adversarial review | adopted (early) | `docs/dev-process.md` defines the routing policy and log; one real unit is recorded on the migrations branch, so adoption is newer than the two mature reference repos. |
| STD-002 PR template | adopted | `.github/PULL_REQUEST_TEMPLATE.md` has the required problem, checks, evidence, and synthetic-data clauses. |
| STD-003 doc freshness | not-yet | No drift was found in the corporate sweep, but only partial mechanical checking exists; release docs still require manual reconciliation. |
| STD-004 identity architecture | adopted | Local accounts, optional OIDC/SAML, and hashed/revocable `adk_` personal access tokens are implemented. |
| STD-005 agent surface | adopted (partial) | MCP shares attributable user/token identity; the company standard remains advisory and AnchorDesk has no PartnerCenterBridge-style approval queue. |
| STD-006 secret handling | adopted | A real `.sops.yaml`/encrypted deployment secret exists, and personal access tokens are write-only and hash-only. |
| STD-007 repo metadata | not-yet | LICENSE and CHANGELOG exist, but company-wide rights-holder and AI-attribution conventions remain undecided. |
| STD-008 UI capture validation | adopted | Every mobile capture now runs the page-overflow assertion; CI executes all views at three representative device widths. |
