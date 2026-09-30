import { useState } from "react";
import { Switch } from "@mui/material";
import TuneOutlined from "@mui/icons-material/TuneOutlined";
import TableChartOutlined from "@mui/icons-material/TableChartOutlined";
import * as api from "../../api/client";
import { AdminPage, PanelError, PanelLoading, SectionCard, SettingRow, useAdminToast, useAsync } from "./kit";

export default function InterfacePanel() {
  const { data, loading, error, reload } = useAsync(() => api.getUiSettings());
  const toast = useAdminToast();
  const [saving, setSaving] = useState(false);

  const setLegacyTable = async (enabled: boolean) => {
    setSaving(true);
    if (await toast.run(
      () => api.updateUiSettings({ legacyTableView: enabled }),
      enabled ? "Legacy table view enabled for everyone." : "Legacy table view hidden.",
    )) reload();
    setSaving(false);
  };

  if (loading && !data) return <PanelLoading rows={1} />;
  if (error || !data) return <PanelError message={error} onRetry={reload} />;

  return (
    <AdminPage icon={TuneOutlined} title="Interface" subtitle="Views and options that apply to every user of this AnchorDesk.">
      <SectionCard icon={TableChartOutlined} title="Ticket views">
        <SettingRow
          title="Legacy table view"
          description="Adds the older DataGrid table to the ticket view switcher (Board · Cards · Table). Board and Cards are the primary views — leave this off unless someone relies on the table."
          control={
            <Switch
              checked={data.legacyTableView}
              disabled={saving}
              onChange={(e) => void setLegacyTable(e.target.checked)}
              slotProps={{ input: { "aria-label": "Legacy table view" } }}
            />
          }
        />
      </SectionCard>
    </AdminPage>
  );
}
