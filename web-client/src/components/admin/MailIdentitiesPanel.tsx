import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AlternateEmailOutlined from "@mui/icons-material/AlternateEmailOutlined";
import ArticleOutlined from "@mui/icons-material/ArticleOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import * as api from "../../api/client";
import ConfirmDialog from "./ConfirmDialog";
import { AdminPage, EmptyRow, PanelError, SectionCard, monoSx, useAdminToast, useAsync } from "./kit";

type Pending = { kind: "identity"; id: number; name: string } | { kind: "template"; id: number; name: string };

export default function MailIdentitiesPanel() {
  const identities = useAsync(() => api.listAllMailIdentities());
  const templates = useAsync(() => api.listMailTemplates());
  const toast = useAdminToast();
  const [iAddr, setIAddr] = useState("");
  const [iName, setIName] = useState("");
  const [tName, setTName] = useState("");
  const [tSubject, setTSubject] = useState("");
  const [tBody, setTBody] = useState("");
  const [deleting, setDeleting] = useState<Pending | null>(null);

  const addIdentity = async () => {
    if (!iAddr.trim()) return;
    if (await toast.run(() => api.createMailIdentity({ address: iAddr.trim(), displayName: iName.trim() || undefined, shared: true }), `${iAddr.trim()} added`)) {
      setIAddr(""); setIName(""); identities.reload();
    }
  };
  const addTemplate = async () => {
    if (!tName.trim() || !tBody.trim()) return;
    if (await toast.run(() => api.createMailTemplate({ name: tName.trim(), subject: tSubject.trim() || undefined, bodyHtml: tBody }), `Template “${tName.trim()}” added`)) {
      setTName(""); setTSubject(""); setTBody(""); templates.reload();
    }
  };

  const identityRows = identities.data ?? [];
  const templateRows = templates.data ?? [];

  return (
    <AdminPage
      icon={AlternateEmailOutlined}
      title="Mail Identities & Templates"
      subtitle="Send-from identities are the addresses techs may send as — shared boxes (help@, support@) and personal aliases on your SMTP domain. The From header uses the chosen identity; the SMTP envelope stays your relay account so SPF and DKIM still pass."
    >
      <SectionCard
        icon={AlternateEmailOutlined}
        title="Send-from identities"
        description="Your relay must allow sending as each address — normal for same-domain aliases."
        status={identityRows.length > 0 ? <Chip size="small" label={identityRows.length} /> : undefined}
      >
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
            <TextField label="Address" placeholder="help@yourdomain" value={iAddr} onChange={(e) => setIAddr(e.target.value)} sx={{ flexGrow: 1 }} />
            <TextField label="Display name" placeholder="Helpdesk" value={iName} onChange={(e) => setIName(e.target.value)} sx={{ flexGrow: 1 }} />
            <Button variant="contained" disabled={!iAddr.trim()} onClick={() => void addIdentity()}>Add shared identity</Button>
          </Stack>
          {identities.error ? <PanelError message={identities.error} onRetry={identities.reload} /> : (
            <Box sx={{ overflowX: "auto", mx: -2, mb: -2, borderTop: 1, borderColor: "divider" }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Address</TableCell><TableCell>Type</TableCell><TableCell>Enabled</TableCell><TableCell align="right" /></TableRow></TableHead>
                <TableBody>
                  {identityRows.map((i) => (
                    <TableRow key={i.id} sx={{ opacity: i.enabled ? 1 : 0.6 }}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{i.displayName ?? i.address}</Typography>
                        {i.displayName && <Typography variant="caption" sx={{ ...monoSx, color: "text.secondary" }}>{i.address}</Typography>}
                      </TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={i.shared ? "Shared" : "Personal"} /></TableCell>
                      <TableCell>
                        <Switch
                          checked={i.enabled}
                          onChange={(e) => void toast.run(() => api.updateMailIdentity(i.id, { enabled: e.target.checked }), `${i.address} ${e.target.checked ? "enabled" : "disabled"}`).then((ok) => ok && identities.reload())}
                          slotProps={{ input: { "aria-label": `${i.enabled ? "Disable" : "Enable"} ${i.address}` } }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Delete identity"><IconButton color="error" aria-label={`Delete ${i.address}`} onClick={() => setDeleting({ kind: "identity", id: i.id, name: i.address })}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!identities.loading && identityRows.length === 0 && (
                    <EmptyRow colSpan={4} icon={AlternateEmailOutlined} title="No identities">The configured SMTP From address is used for everything.</EmptyRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}
        </Stack>
      </SectionCard>

      <SectionCard
        icon={ArticleOutlined}
        title="Boilerplate templates"
        description="Reusable replies techs can insert from the email composer."
        status={templateRows.length > 0 ? <Chip size="small" label={templateRows.length} /> : undefined}
      >
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
            <TextField label="Name" value={tName} onChange={(e) => setTName(e.target.value)} />
            <TextField label="Subject (optional)" value={tSubject} onChange={(e) => setTSubject(e.target.value)} sx={{ flexGrow: 1 }} />
          </Stack>
          <TextField label="Body (HTML)" value={tBody} onChange={(e) => setTBody(e.target.value)} multiline minRows={3} slotProps={{ input: { sx: monoSx } }} />
          <Box><Button variant="contained" disabled={!tName.trim() || !tBody.trim()} onClick={() => void addTemplate()}>Add template</Button></Box>
          {templates.error ? <PanelError message={templates.error} onRetry={templates.reload} /> : (
            <Box sx={{ overflowX: "auto", mx: -2, mb: -2, borderTop: 1, borderColor: "divider" }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Template</TableCell><TableCell>Subject</TableCell><TableCell align="right" /></TableRow></TableHead>
                <TableBody>
                  {templateRows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell sx={{ fontWeight: 600 }}>{t.name}</TableCell>
                      <TableCell>{t.subject ?? <Box component="span" sx={{ color: "text.secondary" }}>—</Box>}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Delete template"><IconButton color="error" aria-label={`Delete template ${t.name}`} onClick={() => setDeleting({ kind: "template", id: t.id, name: t.name })}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!templates.loading && templateRows.length === 0 && (
                    <EmptyRow colSpan={3} icon={ArticleOutlined} title="No templates yet">Add the replies your team types most — password resets, onboarding, “we're on it”.</EmptyRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}
        </Stack>
      </SectionCard>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.kind === "identity" ? `Delete identity ${deleting.name}?` : `Delete template “${deleting?.name}”?`}
        body={deleting?.kind === "identity"
          ? "Techs can no longer choose it as the From address. Mail already sent from it is unaffected."
          : "It disappears from the composer's template picker. Messages already sent are unaffected."}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (!target) return;
          if (target.kind === "identity") void toast.run(() => api.deleteMailIdentity(target.id), `${target.name} deleted`).then((ok) => ok && identities.reload());
          else void toast.run(() => api.deleteMailTemplate(target.id), `Template “${target.name}” deleted`).then((ok) => ok && templates.reload());
        }}
      />
    </AdminPage>
  );
}
