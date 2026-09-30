import { useState } from "react";
import { Alert, Box, Button, Chip, Paper, Slide, Stack, Switch, TextField, Typography } from "@mui/material";
import SecurityOutlined from "@mui/icons-material/SecurityOutlined";
import PasswordOutlined from "@mui/icons-material/PasswordOutlined";
import VpnKeyOutlined from "@mui/icons-material/VpnKeyOutlined";
import BadgeOutlined from "@mui/icons-material/BadgeOutlined";
import * as api from "../../api/client";
import { AdminPage, CopyField, PanelError, PanelLoading, SectionCard, SettingRow, StatusChip, useAdminToast, useAsync } from "./kit";

export default function AuthSettingsPanel() {
  const { data, loading, error, reload } = useAsync(() => api.getAuthSettings());
  const toast = useAdminToast();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  // Bumped on discard so the uncontrolled text fields remount with server values.
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <PanelLoading />;
  if (error || !data) return <PanelError message={error} onRetry={reload} />;

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const val = <T,>(k: string, current: T): T => (k in draft ? (draft[k] as T) : current);
  const dirty = Object.keys(draft).length;
  const save = async () => {
    setSaving(true);
    if (await toast.run(() => api.updateAuthSettings(draft), "Authentication settings saved")) {
      setDraft({});
      setFormKey((k) => k + 1);
      reload();
    }
    setSaving(false);
  };
  const discard = () => { setDraft({}); setFormKey((k) => k + 1); };

  const localOn = val("localEnabled", data.localEnabled);
  const mfaOn = val("mfaRequired", data.mfa.required);
  const oidcOn = val("oidcEnabled", data.oidc.enabled);
  const samlOn = val("samlEnabled", data.saml.enabled);
  const noWayIn = !localOn && !oidcOn && !samlOn;

  return (
    <AdminPage
      icon={SecurityOutlined}
      title="Authentication"
      subtitle="How staff sign in. Seeded from environment variables on first boot, editable here. Secrets are write-only — leave a secret blank to keep it."
      status={mfaOn ? <StatusChip tone="success" label="MFA required" /> : <StatusChip tone="warning" label="MFA optional" />}
    >
      <Stack key={formKey} spacing={2} sx={{ maxWidth: 820, pb: dirty ? 10 : 0 }}>
        {noWayIn && <Alert severity="error">With every method off, nobody can sign in. Keep at least one enabled.</Alert>}

        <SectionCard icon={PasswordOutlined} title="Local accounts & MFA" status={localOn ? <StatusChip tone="success" label="On" /> : <StatusChip tone="neutral" label="Off" />}>
          <SettingRow
            title="Username and password sign-in"
            description="Accounts created under Users & Roles. Turn off once everyone signs in through SSO."
            control={<Switch checked={localOn} onChange={(e) => set("localEnabled", e.target.checked)} slotProps={{ input: { "aria-label": "Username and password sign-in" } }} />}
          />
          <SettingRow
            divider
            title="Require MFA (TOTP)"
            description={`Local accounts enroll an authenticator app at next sign-in. Codes are issued as “${data.mfa.issuer}”.`}
            control={<Switch checked={mfaOn} onChange={(e) => set("mfaRequired", e.target.checked)} slotProps={{ input: { "aria-label": "Require MFA" } }} />}
          />
        </SectionCard>

        <SectionCard
          icon={VpnKeyOutlined}
          title="OpenID Connect"
          description="Entra ID, Google Workspace, Okta, Keycloak and any other OIDC provider."
          status={<>
            {oidcOn ? <StatusChip tone="success" label="Enabled" /> : <StatusChip tone="neutral" label="Off" />}
            {data.oidc.hasClientSecret && <Chip size="small" variant="outlined" label="Secret set" />}
          </>}
          action={<Switch checked={oidcOn} onChange={(e) => set("oidcEnabled", e.target.checked)} slotProps={{ input: { "aria-label": "Enable OpenID Connect" } }} />}
        >
          <Stack spacing={1.75}>
            <TextField label="Issuer URL" placeholder="https://login.microsoftonline.com/<tenant>/v2.0" defaultValue={data.oidc.issuerUrl ?? ""} onChange={(e) => set("oidcIssuerUrl", e.target.value)} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.75}>
              <TextField fullWidth label="Client ID" defaultValue={data.oidc.clientId ?? ""} onChange={(e) => set("oidcClientId", e.target.value)} />
              <TextField fullWidth label="Client secret" type="password" autoComplete="new-password" placeholder={data.oidc.hasClientSecret ? "•••••• set — blank keeps it" : "not set"} slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => set("oidcClientSecret", e.target.value)} />
            </Stack>
            <CopyField label="Redirect URI — register this with your IdP" value={data.oidc.redirectUri} />
          </Stack>
        </SectionCard>

        <SectionCard
          icon={BadgeOutlined}
          title="SAML 2.0"
          description="For IdPs that only speak SAML: ADFS, older Okta and OneLogin tenants."
          status={<>
            {samlOn ? <StatusChip tone="success" label="Enabled" /> : <StatusChip tone="neutral" label="Off" />}
            {data.saml.hasIdpCert && <Chip size="small" variant="outlined" label="Certificate set" />}
          </>}
          action={<Switch checked={samlOn} onChange={(e) => set("samlEnabled", e.target.checked)} slotProps={{ input: { "aria-label": "Enable SAML" } }} />}
        >
          <Stack spacing={1.75}>
            <TextField label="IdP entry point (SSO URL)" defaultValue={data.saml.entryPoint ?? ""} onChange={(e) => set("samlEntryPoint", e.target.value)} />
            <TextField label="SP issuer / entity ID" defaultValue={data.saml.issuer ?? ""} onChange={(e) => set("samlIssuer", e.target.value)} />
            <TextField
              label="IdP signing certificate (PEM)"
              placeholder={data.saml.hasIdpCert ? "Set — leave blank to keep it" : "-----BEGIN CERTIFICATE-----"}
              multiline
              minRows={3}
              slotProps={{ input: { sx: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 } }, inputLabel: { shrink: true } }}
              onChange={(e) => set("samlIdpCert", e.target.value)}
            />
            <CopyField label="ACS / callback URL — register this with your IdP" value={data.saml.callbackUrl} />
          </Stack>
        </SectionCard>
      </Stack>

      <SaveBar count={dirty} saving={saving} blocked={noWayIn} onSave={() => void save()} onDiscard={discard} />
    </AdminPage>
  );
}

/** Floats over the bottom of the viewport whenever a panel holds unsaved edits. */
export function SaveBar({ count, saving, blocked = false, onSave, onDiscard }: { count: number; saving: boolean; blocked?: boolean; onSave: () => void; onDiscard: () => void }) {
  return (
    <Slide direction="up" in={count > 0} mountOnEnter unmountOnExit>
      <Box sx={{ position: "fixed", left: 0, right: 0, bottom: { xs: 12, sm: 20 }, zIndex: (t) => t.zIndex.snackbar - 1, display: "flex", justifyContent: "center", px: 1.5, pointerEvents: "none" }}>
        <Paper
          elevation={8}
          role="region"
          aria-label="Unsaved changes"
          sx={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", px: 2, py: 1.25, borderRadius: 4, border: 1, borderColor: "primary.main", maxWidth: 560, width: "100%" }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
            {count} unsaved change{count === 1 ? "" : "s"}
          </Typography>
          <Button onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button variant="contained" onClick={onSave} disabled={saving || blocked}>{saving ? "Saving…" : "Save changes"}</Button>
        </Paper>
      </Box>
    </Slide>
  );
}
