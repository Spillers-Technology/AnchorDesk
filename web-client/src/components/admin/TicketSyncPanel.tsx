/**
 * Admin → Channels & Integrations → Ticket sync.
 *
 * Replaces the old top-level Sync view and the Jira/ConnectWise cards that
 * used to live in the general Integrations panel (docs/sow-sync-ux.md). Two
 * distinct concepts, deliberately kept apart:
 *
 *  - Connections: the shared account credentials (one Jira site, or the
 *    single legacy ConnectWise account — see connectionRepository.ts for why
 *    ConnectWise isn't a first-class Connection yet).
 *  - Sync jobs: named import/reconciliation scopes that use a connection.
 *
 * A saved connection is never presented as a working one — "Connected" only
 * appears after a successful non-mutating Test, and that result is persisted
 * so it survives a reload.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Step,
  StepLabel,
  Stepper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import SyncIcon from "@mui/icons-material/Sync";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HistoryIcon from "@mui/icons-material/History";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "../../ticketVocab";
import ConfirmDialog from "./ConfirmDialog";
import SyncRunHistoryDialog, { SyncHealthChip } from "./SyncRunHistoryDialog";

type IncludeField = keyof Omit<api.SyncFilterInput, "exclude">;

const FILTER_FIELDS: { key: IncludeField; label: string; options: readonly string[] }[] = [
  { key: "status", label: "Status", options: TICKET_STATUSES },
  { key: "priority", label: "Priority", options: TICKET_PRIORITIES },
  { key: "assignee", label: "Assignee", options: [] },
  { key: "companyName", label: "Company", options: [] },
];

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "Never";
}

export function isJiraConnectionReady(connection: api.Connection): boolean {
  return connection.enabled && connection.configured && connection.lastTestOk === true;
}

export function isLegacyConnectwiseConfigured(
  value: api.IntegrationsView["connectwise"] | null
): boolean {
  if (!value) return false;
  return !!(
    value.server?.trim() &&
    value.company?.trim() &&
    value.publicKey?.trim() &&
    value.hasPrivateKey &&
    value.hasClientId
  );
}

function hasAnyLegacyConnectwiseConfig(value: api.IntegrationsView["connectwise"] | null): boolean {
  if (!value) return false;
  return !!(
    value.server?.trim() ||
    value.company?.trim() ||
    value.publicKey?.trim() ||
    value.hasPrivateKey ||
    value.hasClientId
  );
}

function actionErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function RunResultAlert({
  result,
  onClose,
}: {
  result: api.SyncRunResult;
  onClose?: () => void;
}) {
  const severity = result.status === "error" ? "error" : result.status === "degraded" ? "warning" : "success";
  return (
    <Alert severity={severity} onClose={onClose}>
      <strong>{result.providerName}</strong> — {result.ticketsCreated} created, {result.ticketsUpdated} updated,{" "}
      {result.notesUpserted} notes, {result.ticketsFiltered} filtered locally, {result.ticketsSkipped} skipped,{" "}
      {result.ticketsConflicted} conflicts, {result.errorCount} errors · {result.durationMs}ms
      {result.errors.slice(0, 3).map((message, index) => (
        <Box key={index} sx={{ fontSize: 12, mt: 0.5, overflowWrap: "anywhere" }}>{message}</Box>
      ))}
    </Alert>
  );
}

interface NewJobDefaults {
  type: "jira" | "connectwise";
  connectionId?: number;
}

export default function TicketSyncPanel() {
  const [connections, setConnections] = useState<api.Connection[] | null>(null);
  const [jobs, setJobs] = useState<api.SyncProvider[] | null>(null);
  const [connectwise, setConnectwise] = useState<api.IntegrationsView["connectwise"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionEditor, setConnectionEditor] = useState<api.Connection | "new" | null>(null);
  const [connectwiseEditor, setConnectwiseEditor] = useState(false);
  const [jobEditor, setJobEditor] = useState<api.SyncProvider | NewJobDefaults | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runResults, setRunResults] = useState<api.SyncRunResult[]>([]);
  const [historyJob, setHistoryJob] = useState<api.SyncProvider | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [conns, jobRows, integrations] = await Promise.all([
        api.listConnections("jira"),
        api.listSyncProviders(),
        api.getIntegrations(),
      ]);
      setConnections(conns);
      setJobs(jobRows);
      setConnectwise(integrations.connectwise);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ticket sync configuration");
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleRunAll = async () => {
    setRunningAll(true);
    setError(null);
    try {
      const result = await api.runSync();
      setRunResults(Array.isArray(result) ? result : [result]);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync run failed");
    } finally {
      setRunningAll(false);
    }
  };

  const loading = connections === null || jobs === null;

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>Ticket sync</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Connect an external account, then create a sync job that scopes what comes in. The local
            database always stays the source of truth.
          </Typography>
        </Box>
        {jobs && jobs.length > 0 && (
          <Button
            variant="contained"
            startIcon={runningAll ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
            onClick={handleRunAll}
            disabled={runningAll || jobs.every((j) => !j.enabled)}
            sx={{ flexShrink: 0, width: { xs: "100%", sm: "auto" }, minHeight: { xs: 40 } }}
          >
            {runningAll ? "Running enabled jobs…" : "Run all enabled"}
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {runResults.length > 0 && (
        <Stack spacing={1}>
          {runResults.map((r) => (
            <RunResultAlert
              key={r.providerId}
              result={r}
              onClose={() => setRunResults((rows) => rows.filter((row) => row.providerId !== r.providerId))}
            />
          ))}
        </Stack>
      )}

      {loading ? (
        <CircularProgress sx={{ alignSelf: "flex-start" }} />
      ) : (
        <>
          <ConnectionsSection
            connections={connections!}
            connectwise={connectwise}
            onAddConnection={() => setConnectionEditor("new")}
            onEditConnection={setConnectionEditor}
            onEditConnectwise={() => setConnectwiseEditor(true)}
            onCreateJob={(connectionId) => setJobEditor({ type: "jira", connectionId })}
            onChanged={reload}
          />

          <JobsSection
            jobs={jobs!}
            connections={connections!}
            connectwiseConfigured={isLegacyConnectwiseConfigured(connectwise)}
            onCreate={(defaults) => setJobEditor(defaults)}
            onEdit={setJobEditor}
            onViewHistory={setHistoryJob}
            onChanged={reload}
          />
        </>
      )}

      {connectionEditor !== null && (
        <ConnectionEditorDialog
          connection={connectionEditor === "new" ? null : connectionEditor}
          onClose={() => { setConnectionEditor(null); void reload(); }}
          onSaved={() => { setConnectionEditor(null); reload(); }}
        />
      )}
      {connectwiseEditor && connectwise && (
        <ConnectwiseEditorDialog
          value={connectwise}
          onClose={() => setConnectwiseEditor(false)}
          onSaved={() => { setConnectwiseEditor(false); reload(); }}
        />
      )}
      {jobEditor !== null && (
        <JobEditorDialog
          job={"id" in jobEditor ? jobEditor : null}
          initialType={jobEditor.type}
          initialConnectionId={"id" in jobEditor ? jobEditor.connectionId ?? undefined : jobEditor.connectionId}
          connections={connections ?? []}
          onClose={() => setJobEditor(null)}
          onSaved={() => { setJobEditor(null); reload(); }}
        />
      )}
      {historyJob && (
        <SyncRunHistoryDialog
          open
          job={historyJob}
          onClose={() => setHistoryJob(null)}
        />
      )}
    </Stack>
  );
}

// ─── Connections ────────────────────────────────────────────────────────────

function connectionStateChip(c: api.Connection) {
  if (!c.configured) return <Chip size="small" label="Not configured" />;
  if (c.lastTestOk === true) return <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Connected" />;
  if (c.lastTestOk === false) return <Chip size="small" color="error" icon={<ErrorIcon />} label="Test failed" />;
  return <Chip size="small" color="warning" label="Saved — not tested" />;
}

function ConnectionsSection({
  connections,
  connectwise,
  onAddConnection,
  onEditConnection,
  onEditConnectwise,
  onCreateJob,
  onChanged,
}: {
  connections: api.Connection[];
  connectwise: api.IntegrationsView["connectwise"] | null;
  onAddConnection: () => void;
  onEditConnection: (c: api.Connection) => void;
  onEditConnectwise: () => void;
  onCreateJob: (connectionId: number) => void;
  onChanged: () => void;
}) {
  const [testErrors, setTestErrors] = useState<Record<number, string>>({});
  const connectwiseConfigured = isLegacyConnectwiseConfigured(connectwise);
  const connectwiseIncomplete = !connectwiseConfigured && hasAnyLegacyConnectwiseConfig(connectwise);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Connections</Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={onAddConnection}
          sx={{ width: { xs: "100%", sm: "auto" }, minHeight: { xs: 40 } }}
        >
          Add Jira connection
        </Button>
      </Stack>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
        Account credentials. An MSP syncing several clients' Jira sites adds one connection per tenant.
      </Typography>

      <Stack spacing={1.5}>
        {connections.length === 0 && (
          <Alert severity="info">
            No Jira connections yet. Add one with the site URL, account email, and an API token from{" "}
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">id.atlassian.com</a>.
          </Alert>
        )}
        {connections.map((c) => (
          <Card key={c.id} variant="outlined">
            <CardContent sx={{ "&:last-child": { pb: 2 } }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ fontWeight: 600 }}>{c.name}</Typography>
                  <Chip size="small" variant="outlined" label="jira" />
                  {connectionStateChip(c)}
                  {!c.enabled && <Chip size="small" label="disabled" />}
                </Stack>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={0.5}
                  sx={{ width: { xs: "100%", sm: "auto" }, alignItems: "stretch" }}
                >
                  <TestConnectionButton
                    connection={c}
                    onTested={() => {
                      setTestErrors((current) => {
                        const next = { ...current };
                        delete next[c.id];
                        return next;
                      });
                      onChanged();
                    }}
                    onError={(message) => setTestErrors((current) => ({ ...current, [c.id]: message }))}
                  />
                  <Button
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={() => onEditConnection(c)}
                    aria-label={`Edit Jira connection ${c.name}`}
                    sx={{ minHeight: { xs: 40 } }}
                  >
                    Edit
                  </Button>
                  <DeleteConnectionButton connection={c} onDeleted={onChanged} />
                </Stack>
              </Stack>
              {testErrors[c.id] && (
                <Alert severity="error" sx={{ mt: 1 }} onClose={() => setTestErrors((current) => {
                  const next = { ...current };
                  delete next[c.id];
                  return next;
                })}>
                  {testErrors[c.id]}
                </Alert>
              )}
              {c.lastTestMessage && (
                <Typography variant="body2" sx={{ color: c.lastTestOk ? "text.secondary" : "error.main", mt: 1, wordBreak: "break-word" }}>
                  {c.lastTestMessage}
                  {c.lastTestAt && ` (tested ${formatDate(c.lastTestAt)})`}
                </Typography>
              )}
              {isJiraConnectionReady(c) && (
                <Button
                  size="small"
                  variant="text"
                  startIcon={<AddIcon />}
                  onClick={() => onCreateJob(c.id)}
                  sx={{ mt: 1, minHeight: { xs: 40 }, width: { xs: "100%", sm: "auto" } }}
                >
                  Create sync job with this connection
                </Button>
              )}
            </CardContent>
          </Card>
        ))}

        <Divider />

        {/* ConnectWise is a single legacy account (not yet a Connection — its
            client is still process-global; see connectionRepository.ts). */}
        <Card variant="outlined">
          <CardContent sx={{ "&:last-child": { pb: 2 } }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography sx={{ fontWeight: 600 }}>ConnectWise Manage</Typography>
                <Chip size="small" variant="outlined" label="connectwise · single account" />
                <Chip
                  size="small"
                  color={connectwiseConfigured ? "warning" : "default"}
                  label={connectwiseConfigured ? "Saved — not tested" : connectwiseIncomplete ? "Incomplete" : "Not configured"}
                />
              </Stack>
              <Button
                size="small"
                startIcon={<EditIcon />}
                onClick={onEditConnectwise}
                aria-label="Edit ConnectWise Manage connection"
                sx={{ width: { xs: "100%", sm: "auto" }, minHeight: { xs: 40 } }}
              >
                Edit
              </Button>
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
              Connection testing isn't available for ConnectWise yet — "Saved" means the fields were
              stored, not that they authenticate. Run a sync job to verify.
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Paper>
  );
}

function TestConnectionButton({
  connection,
  onTested,
  onError,
}: {
  connection: api.Connection;
  onTested: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await api.testConnection(connection.id);
      onTested();
    } catch (err) {
      onError(actionErrorMessage(err, "Could not test this connection"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="small"
      variant="outlined"
      onClick={run}
      disabled={busy || !connection.configured}
      startIcon={busy ? <CircularProgress size={14} /> : undefined}
      aria-label={`Test Jira connection ${connection.name}`}
      sx={{ minHeight: { xs: 40 } }}
    >
      {busy ? "Testing…" : "Test"}
    </Button>
  );
}

function DeleteConnectionButton({ connection, onDeleted }: { connection: api.Connection; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="small"
        color="error"
        startIcon={<DeleteIcon />}
        onClick={() => { setError(null); setConfirming(true); }}
        aria-label={`Delete Jira connection ${connection.name}`}
        sx={{ minHeight: { xs: 40 } }}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`Delete connection "${connection.name}"?`}
        body={error ?? "Sync jobs must be reassigned or removed first. Imported tickets retain this tenant identity and also prevent deletion."}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.deleteConnection(connection.id);
            setConfirming(false);
            onDeleted();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete connection");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export function ConnectionEditorDialog({
  connection,
  onClose,
  onSaved,
}: {
  connection: api.Connection | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isPhone = useIsPhone();
  const [name, setName] = useState(connection?.name ?? "");
  const [baseUrl, setBaseUrl] = useState((connection?.config.baseUrl as string) ?? "");
  const [email, setEmail] = useState((connection?.config.email as string) ?? "");
  const [apiToken, setApiToken] = useState("");
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  // A new connection already exists after Save and test returns a remote
  // failure. Keep its id so correcting the form updates that row rather than
  // attempting to create a duplicate with the same name.
  const [persistedConnection, setPersistedConnection] = useState<api.Connection | null>(connection);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<api.ConnectionTestResult | null>(null);
  const hasToken = !!persistedConnection?.config.hasApiToken;
  const canSave = !!(
    name.trim() &&
    baseUrl.trim() &&
    email.trim() &&
    (hasToken || apiToken.trim())
  );

  const saveConnection = async (): Promise<api.Connection> => {
    const config = { baseUrl: baseUrl.trim(), email: email.trim(), apiToken: apiToken.trim() };
    const saved = persistedConnection
      ? await api.updateConnection(persistedConnection.id, { name: name.trim(), config, enabled })
      : await api.createConnection({ name: name.trim(), type: "jira", config, enabled });
    setPersistedConnection(saved);
    return saved;
  };

  const save = async (andTest: boolean) => {
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const saved = await saveConnection();
      if (andTest) {
        const result = await api.testConnection(saved.id);
        if (!result.ok) {
          setTestResult(result);
          return;
        }
      }
      onSaved();
    } catch (err) {
      setError(actionErrorMessage(err, andTest ? "Save or connection test failed" : "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>{connection ? "Edit Jira connection" : "Add Jira connection"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {testResult && (
            <Alert severity={testResult.ok ? "success" : "error"}>
              <strong>{testResult.category === "auth" ? "Authentication rejected" :
                testResult.category === "permission" ? "Permission check failed" :
                testResult.category === "unreachable" ? "Site unreachable" :
                testResult.category === "not_found" ? "Site URL not found" :
                testResult.category === "incomplete" ? "Connection incomplete" :
                "Connection test failed"}</strong>
              {" — "}{testResult.message}
            </Alert>
          )}
          <TextField autoFocus label="Connection name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoso Jira" slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField
            label="Site URL"
            required
            disabled={persistedConnection !== null}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://contoso.atlassian.net"
            helperText={persistedConnection
              ? "The site URL identifies this Jira tenant and cannot be changed. Create a new connection to use a different site."
              : "This becomes the connection's fixed Jira tenant after it is saved."}
          />
          <TextField label="Account email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sync@contoso.com" />
          <TextField
            label="API token"
            required={!hasToken}
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder={hasToken ? "Unchanged — leave blank to keep the saved token" : "id.atlassian.com → Security → API tokens"}
            helperText={hasToken ? "A token is already saved. Leave blank to keep it." : "Required to authenticate."}
          />
          <FormControlLabel
            control={<Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
            label="Enabled (sync jobs may use this connection)"
          />
          <Alert severity="info" variant="outlined">
            Save and test verifies authentication and confirms that this account can browse at least one Jira project.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{
        flexDirection: { xs: "column-reverse", sm: "row" },
        alignItems: "stretch",
        "& > :not(style) ~ :not(style)": { ml: { xs: 0, sm: 1 }, mb: { xs: 1, sm: 0 } },
      }}>
        <Button disabled={saving} onClick={onClose} sx={{ minHeight: { xs: 40 } }}>Cancel</Button>
        <Button
          variant="outlined"
          disabled={saving || !canSave}
          onClick={() => void save(false)}
          sx={{ minHeight: { xs: 40 } }}
        >
          {saving ? "Saving…" : "Save without testing"}
        </Button>
        <Button
          variant="contained"
          disabled={saving || !canSave}
          onClick={() => void save(true)}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ minHeight: { xs: 40 } }}
        >
          {saving ? "Saving and testing…" : "Save and test"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConnectwiseEditorDialog({
  value,
  onClose,
  onSaved,
}: {
  value: api.IntegrationsView["connectwise"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isPhone = useIsPhone();
  const [server, setServer] = useState(value.server ?? "");
  const [company, setCompany] = useState(value.company ?? "");
  const [publicKey, setPublicKey] = useState(value.publicKey ?? "");
  const [privateKey, setPrivateKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = !!(
    server.trim() &&
    company.trim() &&
    publicKey.trim() &&
    (privateKey.trim() || value.hasPrivateKey) &&
    (clientId.trim() || value.hasClientId)
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateIntegration("connectwise", {
        server: server.trim(),
        company: company.trim(),
        publicKey: publicKey.trim(),
        privateKey: privateKey.trim(),
        clientId: clientId.trim(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>Edit ConnectWise Manage</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Alert severity="info" variant="outlined">
            All five values are required. Saving stores them but does not test the ConnectWise account yet.
          </Alert>
          <TextField required label="Server" value={server} onChange={(e) => setServer(e.target.value)} placeholder="na.myconnectwise.net" />
          <TextField required label="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
          <TextField required label="Public key" value={publicKey} onChange={(e) => setPublicKey(e.target.value)} />
          <TextField
            required={!value.hasPrivateKey}
            label="Private key"
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder={value.hasPrivateKey ? "Unchanged — leave blank to keep the saved key" : ""}
            helperText={value.hasPrivateKey ? "Already saved. Leave blank to keep it." : undefined}
          />
          <TextField
            required={!value.hasClientId}
            label="Client ID"
            type="password"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={value.hasClientId ? "Unchanged — leave blank to keep the saved value" : ""}
            helperText={value.hasClientId ? "Already saved. Leave blank to keep it." : undefined}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{
        flexDirection: { xs: "column-reverse", sm: "row" },
        alignItems: "stretch",
        "& > :not(style) ~ :not(style)": { ml: { xs: 0, sm: 1 }, mb: { xs: 1, sm: 0 } },
      }}>
        <Button disabled={saving} onClick={onClose} sx={{ minHeight: { xs: 40 } }}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !canSave}
          onClick={() => void save()}
          sx={{ minHeight: { xs: 40 } }}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Sync jobs ──────────────────────────────────────────────────────────────

function connectionLabel(job: api.SyncProvider, connections: api.Connection[]): string {
  if (job.type === "connectwise") return "Legacy account";
  if (job.connectionId == null) return "Connection required";
  return connections.find((c) => c.id === job.connectionId)?.name ?? `Connection #${job.connectionId}`;
}

function JobsSection({
  jobs,
  connections,
  connectwiseConfigured,
  onCreate,
  onEdit,
  onViewHistory,
  onChanged,
}: {
  jobs: api.SyncProvider[];
  connections: api.Connection[];
  connectwiseConfigured: boolean;
  onCreate: (defaults: NewJobDefaults) => void;
  onEdit: (j: api.SyncProvider) => void;
  onViewHistory: (j: api.SyncProvider) => void;
  onChanged: () => void;
}) {
  const readyJiraConnections = connections.filter(isJiraConnectionReady);
  const canCreate = readyJiraConnections.length > 0 || connectwiseConfigured;
  const createDefaults = (): NewJobDefaults =>
    readyJiraConnections.length > 0
      ? { type: "jira" }
      : { type: "connectwise" };

  if (jobs.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Sync jobs</Typography>
        <Stepper activeStep={canCreate ? 1 : 0} orientation="vertical" sx={{ maxWidth: 420 }}>
          <Step><StepLabel>Save and test a Jira connection, or fully configure ConnectWise</StepLabel></Step>
          <Step>
            <StepLabel>Define scope and create a sync job</StepLabel>
            {canCreate && (
              <Box sx={{ mt: 1, mb: 2 }}>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => onCreate(createDefaults())}
                  sx={{ width: { xs: "100%", sm: "auto" }, minHeight: { xs: 40 } }}
                >
                  Create sync job
                </Button>
              </Box>
            )}
          </Step>
          <Step><StepLabel>Run the first sync</StepLabel></Step>
        </Stepper>
        {!canCreate && (
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
            A saved Jira connection must pass Test before it can create a job. ConnectWise requires all five credential fields.
          </Typography>
        )}
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between", mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Sync jobs</Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => onCreate(createDefaults())}
          disabled={!canCreate}
          sx={{ width: { xs: "100%", sm: "auto" }, minHeight: { xs: 40 } }}
        >
          Create sync job
        </Button>
      </Stack>
      <Stack spacing={1.5}>
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            connectionLabel={connectionLabel(job, connections)}
            onEdit={() => onEdit(job)}
            onViewHistory={() => onViewHistory(job)}
            onChanged={onChanged}
          />
        ))}
      </Stack>
    </Paper>
  );
}

function JobCard({
  job,
  connectionLabel,
  onEdit,
  onViewHistory,
  onChanged,
}: {
  job: api.SyncProvider;
  connectionLabel: string;
  onEdit: () => void;
  onViewHistory: () => void;
  onChanged: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<api.SyncRunResult | null>(null);
  const [confirmAction, setConfirmAction] = useState<"run" | "enable" | null>(null);

  const run = async () => {
    setRunning(true);
    setActionError(null);
    setRunResult(null);
    try {
      const response = await api.runSync(job.name);
      const result = Array.isArray(response) ? response[0] : response;
      if (!result) throw new Error("The sync completed without a result summary.");
      setRunResult(result);
      onChanged();
    } catch (err) {
      setActionError(actionErrorMessage(err, "Run failed"));
    } finally {
      setRunning(false);
    }
  };

  const toggle = async () => {
    setToggling(true);
    setActionError(null);
    try {
      await api.updateSyncProvider(job.id, { enabled: !job.enabled });
      onChanged();
    } catch (err) {
      setActionError(actionErrorMessage(err, `Could not ${job.enabled ? "disable" : "enable"} this sync job`));
    } finally {
      setToggling(false);
    }
  };

  const needsUnfilteredAcknowledgement =
    job.health.status === "never_run" && isEmptyFilter(job.config.filter);
  const requestRun = () => {
    if (needsUnfilteredAcknowledgement) setConfirmAction("run");
    else void run();
  };
  const requestToggle = () => {
    if (!job.enabled && needsUnfilteredAcknowledgement) setConfirmAction("enable");
    else void toggle();
  };

  const scope = job.type === "jira"
    ? [job.config.projectKey && `project ${job.config.projectKey}`, job.config.jql && "custom JQL"].filter(Boolean).join(" · ") || "all visible issues"
    : job.config.board ? `board ${job.config.board}` : "missing board — job must stay disabled";
  const displayedHealth = running ? "running" : job.health.status;
  const latestRun = job.health.latestRun;

  return (
    <Card variant="outlined">
      <CardContent sx={{ "&:last-child": { pb: 2 } }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" }, justifyContent: "space-between" }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <SyncHealthChip status={displayedHealth} />
              <Typography sx={{ fontWeight: 600 }}>{job.name}</Typography>
              <Chip size="small" variant="outlined" label={job.type} />
              <Chip size="small" label={connectionLabel} />
              {job.config.filter && <Chip size="small" color="info" variant="outlined" label="filtered" />}
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>{scope}</Typography>
            {job.health.latestError && (
              <Alert
                severity={job.health.status === "failing" ? "error" : "warning"}
                sx={{ mt: 1, "& .MuiAlert-message": { overflowWrap: "anywhere" } }}
              >
                {job.health.latestError}
              </Alert>
            )}
            {actionError && (
              <Alert severity="error" sx={{ mt: 1 }} onClose={() => setActionError(null)}>
                {actionError}
              </Alert>
            )}
            {runResult && (
              <Box sx={{ mt: 1 }}>
                <RunResultAlert result={runResult} onClose={() => setRunResult(null)} />
              </Box>
            )}
          </Box>
          <Stack
            direction="column"
            spacing={1}
            sx={{ alignItems: { xs: "stretch", sm: "flex-end" }, flexShrink: 0, width: { xs: "100%", sm: "auto" } }}
          >
            <FormControlLabel
              sx={{ m: 0, minHeight: { xs: 40 } }}
              control={<Switch size="small" checked={job.enabled} onChange={requestToggle} disabled={toggling} />}
              label={job.enabled ? "Enabled" : "Disabled"}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={0.5} sx={{ width: { xs: "100%", sm: "auto" } }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={running ? <CircularProgress size={14} /> : <SyncIcon />}
                onClick={requestRun}
                disabled={running || !job.enabled}
                aria-label={`Run sync job ${job.name}`}
                sx={{ minHeight: { xs: 40 } }}
              >
                {running ? "Syncing…" : "Run"}
              </Button>
              <Button
                size="small"
                startIcon={<HistoryIcon />}
                onClick={onViewHistory}
                aria-label={`View run history for ${job.name}`}
                sx={{ minHeight: { xs: 40 } }}
              >
                History
              </Button>
              <Button
                size="small"
                startIcon={<EditIcon />}
                onClick={onEdit}
                aria-label={`Edit sync job ${job.name}`}
                sx={{ minHeight: { xs: 40 } }}
              >
                Edit
              </Button>
              <DeleteJobButton job={job} onDeleted={onChanged} />
            </Stack>
          </Stack>
        </Stack>
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            Last attempt: {formatDate(job.health.lastAttemptAt)}
            {" · "}Last successful: {formatDate(job.health.lastSuccessAt)}
            {job.health.consecutiveFailures > 0
              ? ` · ${job.health.consecutiveFailures} consecutive failure${job.health.consecutiveFailures === 1 ? "" : "s"}`
              : ""}
          </Typography>
          {latestRun && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              Latest run: {latestRun.ticketsCreated} created, {latestRun.ticketsUpdated} updated,{" "}
              {latestRun.ticketsFiltered} filtered locally, {latestRun.ticketsSkipped} skipped,{" "}
              {latestRun.ticketsConflicted} conflicts, {latestRun.errorCount} errors
            </Typography>
          )}
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            Synced through: {formatDate(job.lastSyncedAt)}
            {" — "}incremental watermark only.
          </Typography>
        </Box>
        <ConfirmDialog
          open={confirmAction !== null}
          title={confirmAction === "enable" ? `Enable unfiltered job "${job.name}"?` : `Run unfiltered job "${job.name}"?`}
          body="This job has no include or exclude filter, so its first run can import every ticket in its provider scope, including closed history. Confirm that the project, JQL, or board scope is intentionally broad."
          confirmLabel={confirmAction === "enable" ? "Enable unfiltered job" : "Run unfiltered job"}
          busy={running || toggling}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (action === "enable") void toggle();
            else void run();
          }}
        />
      </CardContent>
    </Card>
  );
}

function DeleteJobButton({ job, onDeleted }: { job: api.SyncProvider; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="small"
        color="error"
        startIcon={<DeleteIcon />}
        onClick={() => { setError(null); setConfirming(true); }}
        aria-label={`Delete sync job ${job.name}`}
        sx={{ minHeight: { xs: 40 } }}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`Delete sync job "${job.name}"?`}
        body={error ?? "This also deletes the job's activity log. Tickets already imported stay put; they just stop syncing until a new job covers them."}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.deleteSyncProvider(job.id);
            setConfirming(false);
            onDeleted();
          } catch (err) {
            setError(actionErrorMessage(err, "Could not delete this sync job"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export function JobEditorDialog({
  job,
  initialType,
  initialConnectionId,
  connections,
  onClose,
  onSaved,
}: {
  job: api.SyncProvider | null;
  initialType?: "jira" | "connectwise";
  initialConnectionId?: number;
  connections: api.Connection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isPhone = useIsPhone();
  const startingType = job?.type ?? initialType ?? "jira";
  const startingConnectionId =
    job?.connectionId ??
    initialConnectionId ??
    "";
  const [name, setName] = useState(job?.name ?? "");
  const [type, setType] = useState<"jira" | "connectwise">(startingType);
  const [connectionId, setConnectionId] = useState<number | "">(startingConnectionId);
  const [projectKey, setProjectKey] = useState(job?.config.projectKey ?? "");
  const [jql, setJql] = useState(job?.config.jql ?? "");
  const [board, setBoard] = useState(job?.config.board ?? "");
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [filter, setFilter] = useState<api.SyncFilterInput | undefined>(job?.config.filter);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUnfiltered, setConfirmingUnfiltered] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    // `filter` must always be present in the payload, even when empty: on an
    // edit, an omitted key means "leave unchanged" (mergeJobConfig only touches
    // keys it receives), so clearing every value has to be sent explicitly
    // rather than by dropping the field.
    const jiraConfig = {
      projectKey: projectKey.trim(),
      jql: jql.trim(),
      filter: filter ?? {},
    };
    const connectWiseConfig = {
      board: board.trim(),
      filter: filter ?? {},
    };
    try {
      if (job) {
        await api.updateSyncProvider(job.id, {
          name: name.trim(),
          enabled,
          // ConnectWise jobs cannot have a connection (see
          // connectionRepository.ts) — send null rather than omitting the key,
          // so editing a job also clears one out if it were ever illegally set.
          connectionId: type === "jira" ? (connectionId === "" ? null : connectionId) : null,
          config: type === "jira" ? jiraConfig : connectWiseConfig,
        });
      } else {
        if (type === "jira") {
          // `canSave` keeps this unreachable from the UI; retaining the runtime
          // guard also satisfies the discriminated API contract if save() is
          // called through a future non-button path.
          if (connectionId === "") throw new Error("Choose a Jira connection");
          await api.createSyncProvider({
            name: name.trim(),
            type: "jira",
            enabled,
            connectionId,
            config: jiraConfig,
          });
        } else {
          await api.createSyncProvider({
            name: name.trim(),
            type: "connectwise",
            enabled,
            connectionId: null,
            config: connectWiseConfig,
          });
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  };

  const requiresUnfilteredAcknowledgement =
    enabled &&
    isEmptyFilter(filter) &&
    (!job || (!job.enabled && job.health.status === "never_run"));
  const selectedConnection = connectionId === ""
    ? null
    : connections.find((connection) => connection.id === connectionId) ?? null;
  const jiraConnectionIsUsable =
    type !== "jira" ||
    (!!selectedConnection && (isJiraConnectionReady(selectedConnection) || job?.connectionId === selectedConnection.id));
  const connectWiseBoardIsUsable =
    type !== "connectwise" || board.trim().length > 0;
  const canSave = !!name.trim() && jiraConnectionIsUsable && connectWiseBoardIsUsable;
  const requestSave = () => {
    if (requiresUnfilteredAcknowledgement) setConfirmingUnfiltered(true);
    else void save();
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>{job ? "Edit sync job" : "Create sync job"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField autoFocus label="Job name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoso — Jira helpdesk" slotProps={{ htmlInput: { maxLength: 100 } }} />

          <FormControl fullWidth disabled={!!job}>
            <InputLabel id="job-type-label">Type</InputLabel>
            <Select labelId="job-type-label" label="Type" disabled={!!job} value={type} onChange={(e) => setType(e.target.value as "jira" | "connectwise")}>
              <MenuItem value="jira">Jira Cloud</MenuItem>
              <MenuItem value="connectwise">ConnectWise Manage</MenuItem>
            </Select>
          </FormControl>
          {job && <Typography variant="caption" sx={{ color: "text.secondary" }}>Type can't change after creation — create a new job instead.</Typography>}

          {type === "jira" ? (
            <>
              <FormControl fullWidth>
                <InputLabel id="job-connection-label">Connection</InputLabel>
                <Select<number | "">
                  labelId="job-connection-label"
                  label="Connection"
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <MenuItem value="">Choose a Jira connection…</MenuItem>
                  {connections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                </Select>
              </FormControl>
              {selectedConnection && !isJiraConnectionReady(selectedConnection) && job?.connectionId !== selectedConnection.id && (
                <Alert severity="warning" variant="outlined">
                  Test this enabled connection successfully before using it for a new sync job.
                </Alert>
              )}
              {connectionId === "" && (
                <Alert severity="warning" variant="outlined">
                  Choose the exact Jira account this job may read and write. AnchorDesk never selects an account implicitly.
                </Alert>
              )}
              <TextField label="Project key (optional)" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder="HELP" helperText="Used only to build the default query below, when JQL is blank." />
              <TextField label="JQL (optional)" value={jql} onChange={(e) => setJql(e.target.value)} multiline minRows={2} placeholder="project = HELP" helperText="Overrides the project key. This exact JQL owns the remote scope, including any lifecycle exclusions." />
            </>
          ) : (
            <TextField
              required
              label="Board name"
              value={board}
              onChange={(e) => setBoard(e.target.value)}
              helperText="Required. AnchorDesk never substitutes a hidden default or widens this job to every board."
            />
          )}

          <FilterEditor value={filter} onChange={setFilter} />

          <FormControlLabel control={<Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label={'Enabled (included in scheduled and "Run all" syncs)'} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{
        flexDirection: { xs: "column-reverse", sm: "row" },
        alignItems: "stretch",
        "& > :not(style) ~ :not(style)": { ml: { xs: 0, sm: 1 }, mb: { xs: 1, sm: 0 } },
      }}>
        <Button disabled={saving} onClick={onClose} sx={{ minHeight: { xs: 40 } }}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !canSave}
          onClick={requestSave}
          sx={{ minHeight: { xs: 40 } }}
        >
          {saving ? "Saving…" : job ? "Save changes" : "Create job"}
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={confirmingUnfiltered}
        title={`${job ? "Enable" : "Create"} unfiltered sync job?`}
        body="This enabled job has no include or exclude filter, so its first run can import every ticket in its project, JQL, or board scope, including closed history."
        confirmLabel={job ? "Enable unfiltered job" : "Create unfiltered job"}
        busy={saving}
        onCancel={() => setConfirmingUnfiltered(false)}
        onConfirm={() => {
          setConfirmingUnfiltered(false);
          void save();
        }}
      />
    </Dialog>
  );
}

// ─── Filter editor ──────────────────────────────────────────────────────────
//
// Deliberately a plain structured form, not a query language: the backend
// vocabulary is four fixed fields with include/exclude semantics
// (syncFilter.ts) — a general rule builder would promise expressiveness that
// doesn't exist. Values within a field are OR'd, fields are AND'd, and
// exclude always wins over include.

function isEmptyFilter(f: api.SyncFilterInput | undefined): boolean {
  if (!f) return true;
  const hasAny = (obj?: Partial<Record<IncludeField, string[]>>) =>
    !!obj && FILTER_FIELDS.some(({ key }) => (obj[key]?.length ?? 0) > 0);
  return !hasAny(f) && !hasAny(f.exclude);
}

function FilterEditor({ value, onChange }: { value: api.SyncFilterInput | undefined; onChange: (v: api.SyncFilterInput | undefined) => void }) {
  const set = (mode: "include" | "exclude", key: IncludeField, values: string[]) => {
    const next: api.SyncFilterInput = { ...value };
    if (mode === "include") next[key] = values;
    else next.exclude = { ...next.exclude, [key]: values };
    onChange(isEmptyFilter(next) ? undefined : next);
  };

  return (
    <Box>
      <Typography variant="subtitle2">Filter (optional)</Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
        Values in a field are "or"; fields are "and"; an exclusion always wins. No values anywhere means
        every ticket is imported.
      </Typography>
      {isEmptyFilter(value) && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 1 }}>No filter set — this job will import every ticket in scope.</Alert>
      )}
      <Stack spacing={1.5}>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>Include</Typography>
        {FILTER_FIELDS.map((f) => (
          <Autocomplete
            key={`inc-${f.key}`}
            multiple
            freeSolo
            size="small"
            options={f.options}
            value={value?.[f.key] ?? []}
            onChange={(_e, v) => set("include", f.key, v as string[])}
            renderInput={(params) => <TextField {...params} label={f.label} placeholder="Add value…" />}
          />
        ))}
        <Divider />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>Exclude</Typography>
        {FILTER_FIELDS.map((f) => (
          <Autocomplete
            key={`exc-${f.key}`}
            multiple
            freeSolo
            size="small"
            options={f.options}
            value={value?.exclude?.[f.key] ?? []}
            onChange={(_e, v) => set("exclude", f.key, v as string[])}
            renderInput={(params) => <TextField {...params} label={f.label} placeholder="Add value…" />}
          />
        ))}
      </Stack>
    </Box>
  );
}
