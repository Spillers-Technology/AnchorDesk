import { useState } from "react";
import { Alert, Box, MenuItem, Select, Switch } from "@mui/material";
import StorefrontOutlined from "@mui/icons-material/StorefrontOutlined";
import PowerSettingsNewOutlined from "@mui/icons-material/PowerSettingsNewOutlined";
import ManageAccountsOutlined from "@mui/icons-material/ManageAccountsOutlined";
import SentimentSatisfiedAltOutlined from "@mui/icons-material/SentimentSatisfiedAltOutlined";
import * as api from "../../api/client";
import { AdminPage, PanelError, PanelLoading, SectionCard, SettingRow, StatusChip, monoSx, useAdminToast, useAsync } from "./kit";

/**
 * The customer-portal switch.
 *
 * Deliberately wordier than a settings toggle usually deserves. Turning this on
 * publishes a surface to people outside the company, and the two things it
 * changes (who can sign in, and that published portal-visibility KB articles
 * become readable without a staff login) are not guessable from a switch
 * labelled "enabled". An admin should be able to make this decision from this
 * screen without reading the docs first.
 */
export default function CustomerPortalPanel() {
  const { data, loading, error, reload } = useAsync(() => api.getPortalSettings());
  const feedback = useAsync(() => api.getFeedbackSettings());
  const toast = useAdminToast();
  const [saving, setSaving] = useState(false);

  const update = async (patch: Partial<api.PortalSettings>, note?: string) => {
    setSaving(true);
    if (await toast.run(() => api.updatePortalSettings(patch), note ?? "Portal settings saved")) reload();
    setSaving(false);
  };

  const updateFeedback = async (patch: Partial<api.FeedbackSettings>) => {
    setSaving(true);
    if (await toast.run(() => api.updateFeedbackSettings(patch), "Feedback settings saved")) feedback.reload();
    setSaving(false);
  };

  if (loading && !data) return <PanelLoading />;
  if (error || !data) return <PanelError message={error} onRetry={reload} />;

  const code = (text: string) => <Box component="code" sx={monoSx}>{text}</Box>;

  return (
    <AdminPage
      icon={StorefrontOutlined}
      title="Customer Portal"
      subtitle={<>Contacts sign in at {code("/portal")} with an emailed link to submit and follow their own tickets.</>}
      status={data.enabled ? <StatusChip tone="success" label="Live" /> : <StatusChip tone="neutral" label="Off" />}
    >
      <SectionCard icon={PowerSettingsNewOutlined} title="Availability">
        <SettingRow
          title="Enable the customer portal"
          description={<>
            Lets your contacts sign in at {code("/portal")} with an emailed link to submit and follow their own tickets.
            Off by default — upgrading AnchorDesk should never publish a customer-facing surface you did not ask for.
          </>}
          control={
            <Switch
              checked={data.enabled}
              disabled={saving}
              onChange={(e) => void update(
                { enabled: e.target.checked },
                e.target.checked
                  ? "Customer portal is live. Approved contacts can request a sign-in link at /portal."
                  : "Customer portal is off. Portal sign-in and portal article reads now refuse.",
              )}
              slotProps={{ input: { "aria-label": "Enable the customer portal" } }}
            />
          }
        />
        <Alert severity={data.enabled ? "warning" : "info"} sx={{ mt: 1 }}>
          {data.enabled ? (
            <>
              While this is on, a contact with an <strong>active portal access grant</strong> (Companies →
              a contact → the key icon) can request a sign-in link, and knowledge-base articles marked{" "}
              <strong>portal</strong> visibility are readable without a staff login.
              Internal articles, drafts, and every staff route stay closed. Existing contacts start
              with no grant — turning this on does not hand anyone access by itself.
            </>
          ) : (
            <>
              While this is off, portal sign-in returns “not found” and knowledge-base
              portal reads require a staff login. Articles you mark as{" "}
              <strong>portal</strong> visibility are still staff-only until you turn this on.
            </>
          )}
        </Alert>
      </SectionCard>

      <SectionCard icon={ManageAccountsOutlined} title="What an approved contact can do">
        <SettingRow
          title="Ticket visibility"
          description={`"Own tickets" matches today's behavior. "Company-wide" also shows every other approved contact at their company their tickets from the grant date onward — the more common expectation, but not every shop wants contacts seeing each other's tickets.`}
          control={
            <Select
              size="small"
              value={data.ticketScope}
              disabled={saving}
              onChange={(e) => void update({ ticketScope: e.target.value as api.PortalSettings["ticketScope"] }, "Ticket visibility updated")}
              inputProps={{ "aria-label": "Ticket visibility" }}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="own">Own tickets only</MenuItem>
              <MenuItem value="company">Company-wide</MenuItem>
            </Select>
          }
        />
        <SettingRow
          divider
          title="Technician identity"
          description={`"Anonymous" renders every reply as "Support" (today's behavior). "Named" shows a technician's display name and avatar when they've opted in under Account → Portal profile — never their login email or phone unless they add those separately.`}
          control={
            <Select
              size="small"
              value={data.technicianIdentity}
              disabled={saving}
              onChange={(e) => void update({ technicianIdentity: e.target.value as api.PortalSettings["technicianIdentity"] }, "Technician identity updated")}
              inputProps={{ "aria-label": "Technician identity" }}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="anonymous">Anonymous ("Support")</MenuItem>
              <MenuItem value="named">Named (opted-in technicians)</MenuItem>
            </Select>
          }
        />
        <SettingRow
          divider
          title="Attachments"
          description="Allow contacts to attach files to tickets and comments."
          control={<Switch checked={data.allowAttachments} disabled={saving} onChange={(e) => void update({ allowAttachments: e.target.checked }, e.target.checked ? "Contacts can attach files" : "Contact attachments turned off")} slotProps={{ input: { "aria-label": "Allow contacts to attach files" } }} />}
        />
        <SettingRow
          divider
          title="Self-solve"
          description={'Allow contacts to mark their own ticket "solved".'}
          control={<Switch checked={data.allowSelfSolve} disabled={saving} onChange={(e) => void update({ allowSelfSolve: e.target.checked }, e.target.checked ? "Contacts can solve their own tickets" : "Self-solve turned off")} slotProps={{ input: { "aria-label": "Allow contacts to mark their own ticket solved" } }} />}
        />
      </SectionCard>

      {!feedback.loading && feedback.data && (
        <SectionCard icon={SentimentSatisfiedAltOutlined} title="Feedback (CSAT)" status={feedback.data.enabled ? <StatusChip tone="success" label="Collecting" /> : <StatusChip tone="neutral" label="Off" />}>
          <SettingRow
            title="Let contacts rate a ticket"
            description="Positive / neutral / negative, plus an optional comment."
            control={<Switch checked={feedback.data.enabled} disabled={saving} onChange={(e) => void updateFeedback({ enabled: e.target.checked })} slotProps={{ input: { "aria-label": "Let contacts rate a ticket" } }} />}
          />
          <SettingRow
            divider
            title="Prompt on solve"
            description={'Ask for a rating when a contact marks their ticket "solved".'}
            control={<Switch checked={feedback.data.promptOnSolve} disabled={saving || !feedback.data.enabled} onChange={(e) => void updateFeedback({ promptOnSolve: e.target.checked })} slotProps={{ input: { "aria-label": "Prompt for a rating when solved" } }} />}
          />
        </SectionCard>
      )}
    </AdminPage>
  );
}
