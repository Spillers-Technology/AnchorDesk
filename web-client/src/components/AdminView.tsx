import { useEffect, useRef } from "react";
import { Box, Stack } from "@mui/material";
import { useSearchParams } from "react-router-dom";
import AdminRail from "./admin/AdminRail";
import { AdminToastProvider } from "./admin/kit";
import { NAV_IDS, type AdminSection } from "./admin/nav";
import OverviewPanel from "./admin/OverviewPanel";
import UsersPanel from "./admin/UsersPanel";
import AuthSettingsPanel from "./admin/AuthSettingsPanel";
import TeamsPanel from "./admin/TeamsPanel";
import SlaPanel from "./admin/SlaPanel";
import LabelsPanel from "./admin/LabelsPanel";
import CustomFieldsPanel from "./admin/CustomFieldsPanel";
import AutomationsPanel from "./admin/AutomationsPanel";
import InterfacePanel from "./admin/InterfacePanel";
import MailboxesPanel from "./admin/MailboxesPanel";
import MailIdentitiesPanel from "./admin/MailIdentitiesPanel";
import CustomerPortalPanel from "./admin/CustomerPortalPanel";
import IntegrationsPanel from "./admin/IntegrationsPanel";
import ProbesPanel from "./admin/ProbesPanel";
import DevicesPanel from "./admin/DevicesPanel";
import AuditPanel from "./admin/AuditPanel";
import ChecklistTemplatesPanel from "./admin/ChecklistTemplatesPanel";
import PortalRegistrationsPanel from "./admin/PortalRegistrationsPanel";
import KbArticlesPanel from "./admin/KbArticlesPanel";
import TicketSyncPanel from "./admin/TicketSyncPanel";

/**
 * Admin console — a rail (a section switcher below `md`) and one panel per
 * section. The active section lives in the `?admin=` query param so sections
 * are deep-linkable, survive refresh, and honor the browser back button.
 * Panels are built from the kit in `admin/kit.tsx`; navigation metadata lives
 * in `admin/nav.tsx`.
 */
export default function AdminView({ onOpenTickets }: { onOpenTickets?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("admin") as AdminSection | null;
  const section: AdminSection = raw && NAV_IDS.has(raw) ? raw : "overview";
  const contentRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const setSection = (next: AdminSection) => {
    setSearchParams((params) => {
      params.set("admin", next);
      return params;
    });
  };

  // A section change is a page change: bring the new panel's top into view
  // (the switcher sits above it on phones) — but not on first load.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const top = contentRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) contentRef.current?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <AdminToastProvider>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { xs: "stretch", md: "flex-start" } }}>
        <AdminRail active={section} onSelect={setSection} />
        <Box
          key={section}
          ref={contentRef}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            width: "100%",
            scrollMarginTop: 80,
            // Column headers never wrap; wide tables scroll inside their own container.
            "& .MuiTableCell-head": { whiteSpace: "nowrap" },
            animation: "ad-panel-in 220ms ease-out",
            "@keyframes ad-panel-in": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
          }}
        >
          {section === "overview" && <OverviewPanel onNavigate={setSection} onOpenTickets={onOpenTickets} />}
          {section === "users" && <UsersPanel />}
          {section === "auth" && <AuthSettingsPanel />}
          {section === "integrations" && <IntegrationsPanel onNavigate={setSection} />}
          {section === "interface" && <InterfacePanel />}
          {section === "customer-portal" && <CustomerPortalPanel />}
          {section === "portal-registrations" && <PortalRegistrationsPanel />}
          {section === "sla" && <SlaPanel />}
          {section === "mailboxes" && <MailboxesPanel />}
          {section === "mail" && <MailIdentitiesPanel />}
          {section === "labels" && <LabelsPanel />}
          {section === "teams" && <TeamsPanel />}
          {section === "custom-fields" && <CustomFieldsPanel />}
          {section === "checklists" && <ChecklistTemplatesPanel />}
          {section === "knowledge-base" && <KbArticlesPanel />}
          {section === "automations" && <AutomationsPanel />}
          {section === "ticket-sync" && <TicketSyncPanel />}
          {section === "probes" && <ProbesPanel />}
          {section === "devices" && <DevicesPanel onNavigate={setSection} />}
          {section === "audit" && <AuditPanel />}
        </Box>
      </Stack>
    </AdminToastProvider>
  );
}
