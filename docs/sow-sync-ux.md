# Statement of Work: Ticket Sync Setup, Filtering, and Health

This SOW is limited to the ConnectWise Manage/Jira ticket-sync flow. It does not redesign the broader product or the RMM device-sync experience.

## 1. Diagnosis

Ranked by user pain and likelihood of causing the observed failure:

1. **The setup journey is split across two unrelated information architectures.**

   “Sync” is permanently exposed under top-level Operations, while its credentials are admin-only under Channels & Integrations ([DashboardDrawer.tsx:51](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/DashboardDrawer.tsx:51), [AdminView.tsx:107](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/AdminView.tsx:107)). The user can complete the credential form and reasonably believe Jira is configured, even though no `SyncProvider` job exists.

   The Add-provider dialog does contain a helper sentence saying credentials come from Admin → Integrations, but only after the user independently discovers and opens that dialog; it is not a prerequisite indicator, link, or completion state ([SyncView.tsx:394](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/SyncView.tsx:394)). The Integrations page provides no reciprocal path. This violates task continuity and forces users to reconstruct the backend data model from the UI.

2. **Saved credentials have no verification or meaningful completion feedback.**

   The Jira card marks itself “configured” when URL and email exist, without requiring the token or verifying the remote account ([AdminView.tsx:964](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/AdminView.tsx:964)). “Jira saved” means only that AnchorDesk persisted the fields. It does not mean authentication, permissions, or JQL work.

   Consequently, the first real validation is a production sync run. Authentication and query errors then appear far away in a record-oriented log. This is why “I entered credentials and nothing happened” is the natural interpretation.

3. **JQL has two editable owners and invisible precedence.**

   JQL appears in both the Jira credentials card ([AdminView.tsx:968](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/AdminView.tsx:968)) and the Add-provider dialog ([SyncView.tsx:414](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/SyncView.tsx:414)).

   Actual precedence is provider-row JQL, then integration-level JQL, then the project/default query ([JiraProvider.ts:114](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/providers/JiraProvider.ts:114)). None of this is visible. A user changing the Integrations value may therefore see no effect because an unseen provider override wins. This is a conceptual-integrity and error-prevention failure, not merely weak helper text.

4. **Configuration mistakes are not recoverable in place.**

   The provider list deliberately omits `config`, and `PATCH` accepts only `enabled` ([sync.ts:39](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/routes/sync.ts:39), [sync.ts:102](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/routes/sync.ts:102)). A typo requires deletion and recreation. Deletion also cascades through the activity log ([sync.ts:123](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/routes/sync.ts:123)).

   This makes a low-risk correction destructive and removes the evidence needed to diagnose the mistake. The UI compounds this by using `window.confirm` instead of the existing themed, phone-safe `ConfirmDialog` pattern ([SyncView.tsx:149](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/SyncView.tsx:149), [ConfirmDialog.tsx:14](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/admin/ConfirmDialog.tsx:14)).

5. **“Last Synced” presents an internal watermark as health.**

   `lastSyncedAt` advances when the incremental watermark can safely move, even if the result includes reconcile conflicts, note failures, or other durable per-ticket errors ([syncService.ts:268](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/services/syncService.ts:268)). It is not a “last fully successful run” timestamp.

   The UI nevertheless labels it “Last Synced” and gives it the strongest status position in the provider table ([SyncView.tsx:244](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/SyncView.tsx:244)). The available log endpoint returns record-level events, not run-level outcomes ([sync.ts:138](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/routes/sync.ts:138)). It cannot reliably answer whether the latest run succeeded, processed zero records, partially failed, or never reached the remote system.

6. **The most important scope-control feature has no affordance.**

   `syncFilter.ts` supplies a clean provider-neutral model over assignee, status, priority, and company, including inclusion and exclusion semantics ([syncFilter.ts:21](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/services/syncFilter.ts:21)). Yet it can only be entered as JSON when creating a provider and cannot be viewed afterward.

   This hides a valuable MSP feature and makes broad accidental imports more likely. Because the vocabulary is four fixed fields with simple AND/OR rules, exposing it does not require a general-purpose query language.

7. **The navigation and RBAC models disagree.**

   The top-level Sync destination is shown to every signed-in role. `SyncView` says technicians can trigger runs, but `/sync/run` is admin-only ([SyncView.tsx:58](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/SyncView.tsx:58), [sync.ts:13](/Users/jdspille/Documents/GitHub/AnchorDesk/backend/src/routes/sync.ts:13)). A technician therefore receives an action they cannot complete. Readonly users receive an operational destination that is irrelevant to their role.

8. **The current surface does not meet the established mobile pattern.**

   Wide tables use internal horizontal scrolling, but the primary configuration dialog is not full-screen on phones ([SyncView.tsx:394](/Users/jdspille/Documents/GitHub/AnchorDesk/web-client/src/components/SyncView.tsx:394)). AnchorDesk requires full-screen phone dialogs, touch targets of at least 40px, and no horizontal page scrolling at 360px—and formally supports down to 344px ([mobile.md:8](/Users/jdspille/Documents/GitHub/AnchorDesk/docs/mobile.md:8), [mobile.md:37](/Users/jdspille/Documents/GitHub/AnchorDesk/docs/mobile.md:37)).

## 2. Design direction

**Remove Sync from the top-level drawer.**

Ticket sync is an administrative integration lifecycle—not a primary technician workspace. Its credentials, scope, scheduler participation, filtering, connection testing, and failure recovery should live together under:

**Admin console → Channels & Integrations → Ticket sync**  
Deep link: `?admin=ticket-sync`

The page should present two related but distinct concepts:

- **Connections:** the shared Jira or ConnectWise account credentials.
- **Sync jobs:** one or more named import/reconciliation scopes using that connection, with provider-specific query options, provider-neutral filters, enabled state, run controls, and health.

This respects the existing backend’s one-credential-set-per-type plus multiple-provider-row model without exposing that implementation detail as two unrelated destinations.

The existing Integrations panel should remove the Jira and ConnectWise credential fields. It may retain one lightweight “Ticket sync is managed under Ticket sync” link during migration, but no editable duplication. SMTP, storage, and RMM settings remain where they are.

**Rejected direction: retain top-level Sync as an operational dashboard and merely link it to Integrations.** That would reduce the immediate dead end but preserve two owners, expose admin operations to unauthorized roles, and consume global navigation space for an infrequent configuration task. It is acceptable only as a short-lived migration bridge.

I also reject an arbitrary query-builder for filters. Four known fields with include/exclude lists are better represented by a structured form. A general nested rule builder would promise Boolean expressiveness the backend does not support and would be disproportionately expensive for a solo developer.

## 3. Workstreams

Effort assumes one developer and includes focused frontend/backend tests: **S = 1–2 days, M = 3–5 days, L = roughly 1–2 weeks.**

### Workstream A — Consolidate IA and align RBAC

**Scope**

- Add `ticket-sync` to the Admin section vocabulary and Channels & Integrations rail.
- Move the ticket-sync surface into a self-contained `TicketSyncPanel`.
- Remove Sync from `OPS_NAV`, `ViewMode`, App rendering, and app-bar title handling.
- Rename user-facing “provider” to **sync job**. Retain “provider” only in technical/API documentation.
- Remove Jira and ConnectWise editable credential cards from the general Integrations panel once the new panel has parity.
- Remove the marketing-oriented `IntegrationsRoadmap` from the operational workflow; it does not help complete or diagnose setup.

**MUI components/patterns**

- Existing admin rail `ListItemButton` and `?admin=` deep-link pattern.
- `Stack`, outlined `Paper`, `Alert`, and guided empty-state cards.
- `ConfirmDialog` for removal.
- `PanelSearch` for an already-loaded job/activity list if the list warrants filtering.

**Mobile at 360px**

- Reuse the admin rail’s horizontal phone treatment.
- Page padding follows existing responsive main padding.
- Page heading and primary action stack vertically at `xs`.
- Jobs render as cards at `xs`, not a five-column table requiring the user to scroll sideways to discover health/actions.

**Backend changes**

- Gate `GET /sync/providers` and `GET /sync/log` consistently as admin-only unless the product owner explicitly chooses technician observability.
- No schema change required for the IA shell.

**Acceptance criteria**

- No top-level drawer item named Sync exists.
- `?admin=ticket-sync` survives refresh and browser back/forward navigation.
- Only admins can see or call ticket-sync administration routes.
- No editable Jira or ConnectWise credential field remains outside Ticket sync.
- A fresh admin can identify the next setup action without knowing that `SyncProvider` exists.
- Existing providers remain accessible after the navigation change.

**Effort:** S

### Workstream B — Guided connection setup and connection testing

**Scope**

- Provide Jira and ConnectWise connection cards at the top of Ticket sync.
- Distinguish these states: **Not configured**, **Saved—not tested**, **Connected**, and **Test failed**.
- After saving credentials, offer an immediate **Save and test** action.
- On success, identify the connected site/account where safely available and present **Create sync job** as the next action.
- On failure, preserve the form and display an actionable category: authentication rejected, site unreachable/TLS, insufficient permission, malformed URL, or unknown remote response.
- Never imply that “saved” means “working.”

**MUI components/patterns**

- Outlined `Card`/`Paper`, semantic `Chip`, inline `Alert`.
- `Dialog` for credential editing.
- A compact vertical `Stepper` only for the no-job onboarding state: Connect → Define scope → Run first sync.
- `CircularProgress` in the test action; no indefinite spinner without text.

**Mobile at 360px**

- Credential dialogs use `useIsPhone()` and `fullScreen={isPhone}`.
- Actions become full-width and stack vertically.
- Error details wrap; no raw response payload or fixed-width code block.
- Primary controls remain at least 40px high and reachable with the software keyboard open.

**Backend changes**

- Add admin-only non-mutating test endpoints, preferably `POST /integrations/jira/test` and `/connectwise/test`.
- Tests use stored credentials after save and return a small structured result such as `{ ok, category, message, identity, testedAt }`.
- Persist non-secret last-test metadata so status survives refresh.
- Sanitize responses and server logs so tokens, authorization headers, and full remote payloads never return to the client.
- Test read access and query validity separately from actual sync mutation; do not create or modify a remote ticket.

**Acceptance criteria**

- Invalid Jira credentials produce an explicit failure without creating a sync job or importing data.
- Valid credentials produce a persistent Connected state and a clear next action.
- Reloading the page retains the last-tested status and time.
- Replacing a secret works despite secrets remaining write-only; the API still returns only `hasApiToken`/equivalent flags.
- Test endpoints are admin-only and non-mutating.
- Network, authentication, permission, and query errors have distinguishable user messages.

**Effort:** M

### Workstream C — Editable sync jobs and a single query owner

**Scope**

- Replace Add-provider-only behavior with create, view, edit, enable/disable, run, and remove operations.
- Make name, scope, filter summary, connection state, enabled state, and health visible.
- Keep provider type immutable after creation; changing Jira to ConnectWise is a different job.
- Move Jira project/JQL scope out of the credential record and into the sync job.
- Move ConnectWise board selection into the job.
- Use the existing `ConfirmDialog` for removal and state exactly what happens to historical activity.

**MUI components/patterns**

- Desktop/tablet: compact table or cards with an overflow action menu.
- Phone: stacked outlined cards with status at the top and full-width Run/Edit actions.
- Full-screen create/edit dialog on phones.
- `TextField`, `Select`, helper text, `Chip`, `Menu`, and `Switch`.
- Effective scope summary displayed outside the editor.

**Mobile at 360px**

- No action is reachable only through hover.
- Edit forms are single-column.
- JQL is multiline and does not force viewport width.
- Destructive removal remains a separate, clearly labeled action—not adjacent to Run.

**Backend changes**

- `GET /sync/providers` returns an explicit safe DTO, not raw arbitrary JSON—for example `publicConfig: { board?, projectKey?, jql?, filter? }`.
- Expand `PATCH /sync/providers/:id` to accept validated name, enabled state, and safe type-specific config.
- Reject unknown config keys and invalid filters on update as well as create.
- Record provider create/update/enable/remove mutations in the audit log.
- Migrate or materialize legacy integration-level Jira `projectKey`/`jql` into existing Jira jobs that lack an override.
- Retain a documented compatibility path for environment-seeded legacy values, but do not expose a second editable JQL field.
- Prefer soft archival or retained run history; if hard deletion remains, the API and confirmation must make log loss explicit.

**Acceptance criteria**

- An admin can correct JQL, project scope, board, name, and filter without deleting the job.
- After editing and reloading, the same effective configuration is displayed.
- JQL has exactly one editable location.
- Existing installations retain their effective Jira query after migration.
- The editor indicates when a value was inherited from a legacy default until it is materialized.
- Raw credentials and future unknown config keys never appear in provider responses.
- Invalid JQL/filter input fails without replacing the last valid saved job.
- Enable/disable and edits are audit-attributed to the current admin.

**Effort:** L

### Workstream D — Provider-neutral filter editor

**Scope**

- Surface all four backend-supported fields: Assignee, Status, Priority, and Company.
- Separate **Include** and **Exclude** sections.
- Explain the exact semantics in plain language:
  - values within one field are OR;
  - populated include fields are AND;
  - any matching exclusion removes the ticket;
  - exclusion wins;
  - no clauses means all tickets.
- Show a readable filter summary on each job.
- Show `ticketsFiltered` in manual-run results; the backend already returns it, but the current UI result type and rendering omit it.
- Do not expose raw JSON in the normal flow.

**MUI components/patterns**

- Two `Accordion` sections: Include and Exclude.
- Four `Autocomplete multiple freeSolo` controls using chips.
- Reuse available local company/assignee/status/priority values as suggestions, while retaining free entry because remote vocabulary can differ.
- A warning `Alert` when enabling an unfiltered job for its first run.
- Optional read-only advanced JSON preview for support purposes, not an editable primary interface.

**Mobile at 360px**

- Each field occupies a full row.
- Autocomplete chips wrap inside the control.
- Accordions and remove icons remain touch-sized.
- The full-screen job editor keeps Save actions reachable after long filter content.

**Backend changes**

- No change to matching semantics.
- Provider read/update work from Workstream C is required.
- Add a small capabilities endpoint, or equivalent typed response, exposing filterable field IDs and semantics so the UI does not invent a second vocabulary.
- Continue server-side parsing and rejection of unknown fields.
- A remote-count preview endpoint is optional and should not block the first filter release.

**Acceptance criteria**

- An admin can express “assignee is Joey or Jess, but exclude Closed” without JSON.
- Saving produces the existing `config.filter` shape and survives edit/reload.
- The same filter works for Jira and ConnectWise.
- Filter summaries accurately reflect include/exclude behavior.
- Manual run feedback states how many remote tickets were excluded.
- Clearing all fields results in “All tickets” with a visible warning before first activation.
- Backend unit tests continue to prove case-insensitive matching and “exclude wins.”

**Effort:** M after Workstream C

### Workstream E — Persistent run-level health and activity

**Scope**

- Replace timestamp-as-health with explicit run health.
- Show, per job:
  - Enabled/disabled
  - Never run/running/healthy/degraded/failing
  - Last attempt
  - Last successful run
  - Latest actionable error
  - Consecutive failed-run count
  - Counts for created, updated, filtered, skipped/conflicted, and errors
- Separate run summaries from per-ticket activity.
- Allow an admin to open a run and inspect its record-level log entries.

**MUI components/patterns**

- Semantic status `Chip` with icon and text; never color alone.
- Summary cards on phones and compact rows at larger widths.
- `Alert` for the latest failure.
- `LinearProgress`/`CircularProgress` with “Syncing…” label for manual runs.
- Expandable run details through `Accordion` or a full-screen phone dialog.
- `PanelSearch` and status filters for recent activity if all rows are loaded client-side.

**Mobile at 360px**

- Health and latest error appear before timestamps and secondary metadata.
- Record-level tables scroll inside their own container; the job summary itself does not require horizontal scrolling.
- Long error messages wrap and can be expanded.
- Run details open full-screen on phones.

**Backend changes**

- Add a run-level record, preferably `SyncRun`, because `SyncLog` has no run boundary and cannot represent successful zero-record runs.
- Record every scheduled and manual attempt, including config errors, remote fetch failures, zero-result successes, partial failures, and duration.
- Define statuses:
  - **Success:** remote fetch completed and no processing errors.
  - **Degraded:** fetch completed but conflicts/skips or record-level errors occurred.
  - **Error:** configuration or remote fetch failed, or the run could not proceed.
- Derive consecutive error runs and last success from `SyncRun`, rather than overloading `lastSyncedAt`.
- Return a health summary with provider/job list responses.
- Retain `SyncLog` as detail, linked to its run.
- Ensure scheduler and manual execution use the same recording path.

**Acceptance criteria**

- A failed credential/query run is visible after refresh without opening raw logs.
- “Last successful” never advances on an error or degraded run.
- A successful run that imports zero tickets still produces a successful run record.
- Three failed attempts display “3 consecutive failures.”
- The next successful run clears the consecutive-failure count.
- A mixed-result run is Degraded, not Healthy.
- Manual and scheduled runs produce identical health semantics.
- No screen labels `lastSyncedAt` as proof of health.

**Effort:** L

### Workstream F — Mobile, accessibility, and regression proof

**Scope**

- Add the consolidated page and all important states to the existing screenshot harness.
- Replace the current top-level `sync` capture with:
  - `admin-ticket-sync`
  - `ticket-sync-empty`
  - `ticket-sync-connection-error`
  - `ticket-sync-job-editor`
  - `ticket-sync-filter-editor`
  - `ticket-sync-run-failed`
- Add mocked integration settings, safe provider config, connection-test results, run health, and filters.
- Add full-screen dialog regression tests for connection and job editors.

The current capture harness already includes the old Sync destination, but not the Integrations panel or its dialogs ([capture-mobile-media.mjs:178](/Users/jdspille/Documents/GitHub/AnchorDesk/docs/scripts/capture-mobile-media.mjs:178)). New views are explicitly required to enter the matrix ([mobile.md:92](/Users/jdspille/Documents/GitHub/AnchorDesk/docs/mobile.md:92)).

**MUI components/patterns**

- Existing `useIsPhone`, theme-owned dialog chrome, focus management, accessible labels, tooltips for icon-only desktop actions, and visible text on phone actions.

**Mobile at 360px**

- Verify at 344, 360, 393, 412, and 717px touch profiles.
- No horizontal page scroll.
- No clipped actions or hover-only controls.
- Full-screen phone dialogs have reachable Cancel/Save actions.
- Test with long provider names, long JQL, many chips, and long errors—not only ideal mock data.

**Backend changes**

- None beyond stable mock DTOs matching the new contracts.

**Acceptance criteria**

- All new states pass the five-device capture matrix.
- At least one 360px capture accompanies each UI PR.
- Automated tests assert both new editors are full-screen below `sm`.
- Keyboard focus enters dialogs, returns to the launching control, and never becomes trapped.
- Status meaning is available to screen readers and does not rely only on color.

**Effort:** S, performed continuously rather than deferred

## 4. Sequencing

### Milestone 1 — Stop silent setup failure

Ship first:

- Connection-test endpoints and Save and test.
- Explicit reciprocal links between the existing two screens as a temporary bridge.
- Correct role gating for Run.
- Safe provider-config read/update API.
- JQL precedence made visible and legacy migration prepared.
- Replace destructive `window.confirm`.

This ships first because it directly prevents the failure that triggered the review. If development stops here, the IA remains temporarily split, but users can discover the dependency, validate credentials, and fix configuration without destructive recreation.

### Milestone 2 — Establish the single home and surface filtering

Then ship:

- Admin → Ticket sync panel.
- Connection and sync-job terminology.
- Editable jobs.
- Canonical job-owned JQL/project/board scope.
- Structured include/exclude filter editor.
- Remove the top-level Sync destination and duplicate credential fields.

This is the main product improvement and should be the release that advertises provider-neutral filtering. If development stops after this milestone, setup and filtering are coherent, while health remains limited to immediate run results and existing activity detail.

### Milestone 3 — Make health trustworthy

Finally ship:

- Run-level persistence.
- Healthy/degraded/error semantics.
- Last attempt, last success, consecutive failures, and detailed run inspection.
- Scheduled/manual parity.

This is sequenced after setup because it requires a durable run model and scheduler changes, while connection testing can resolve the immediate user failure sooner.

Mobile captures, mock data, and tests ship with every milestone, not as cleanup.

## 5. Out of scope

- **RMM device-sync redesign.** Tactical, NinjaOne, and Datto have different inventory/script workflows in Admin → Devices. They may receive reciprocal links later, but this SOW does not merge ticket and device sync.
- **New providers.** Autotask, ConnectWise Automate, and roadmap work are unrelated to repairing this flow.
- **Multiple credential accounts per provider type.** The current backend has one shared Jira and one shared ConnectWise credential set. Supporting several tenants/accounts requires a new connection entity and is materially larger.
- **Arbitrary nested query building.** The backend supports four fields with fixed AND/OR/exclude semantics, not nested Boolean groups.
- **Provider-specific remote vocabulary discovery.** Initial fields remain free-entry with local suggestions. Jira project/status/assignee discovery can be a later enhancement.
- **Configurable scheduling.** The existing environment-driven interval and scheduler remain unchanged.
- **Ticket conflict-resolution redesign.** Conflict handling inside individual tickets is adjacent but separate.
- **External alerting.** Email, webhook, or notification escalation for failed sync jobs is not included.
- **General admin-console or design-system changes.** This work uses the current MUI 9 components, rail, dialogs, search, empty states, and responsive conventions.

## 6. Open questions for the product owner

1. Is one Jira account and one ConnectWise account per AnchorDesk installation an intentional long-term constraint? If not, “connection” must become a first-class database record before finalizing the IA.
2. Should technicians have any ticket-sync access? My recommendation is **admin-only configuration and manual runs**, with sync conflict resolution remaining in normal ticket work. The current UI comment and backend policy disagree.
3. Should legacy `JIRA_JQL` and `JIRA_PROJECT_KEY` environment settings remain supported indefinitely, or can they be migrated into sync jobs and formally deprecated?
4. Should connection testing verify only safe read access, or must it also prove two-way write permissions? A truly conclusive write test may require creating and deleting remote test data.
5. Should enabling an unfiltered job require explicit acknowledgement that it may import every ticket in scope? I recommend requiring acknowledgement on the first run, not on every run.
6. Should removing a job retain its run history? I recommend soft archival because sync history is operational evidence; the current cascade delete works against that goal.
7. Does “degraded” include held conflicts and skipped records, or should conflicts have their own at-a-glance state?
8. Is a remote filter preview—“fetched 412, would import 37”—important enough for the first filter release, or can it follow after the structured editor?

No files were edited.

