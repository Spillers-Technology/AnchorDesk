import type { SvgIconComponent } from "@mui/icons-material";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import PeopleOutlined from "@mui/icons-material/PeopleOutlined";
import SecurityOutlined from "@mui/icons-material/SecurityOutlined";
import CableOutlined from "@mui/icons-material/CableOutlined";
import EmailOutlined from "@mui/icons-material/EmailOutlined";
import RouterOutlined from "@mui/icons-material/RouterOutlined";
import DevicesOutlined from "@mui/icons-material/DevicesOutlined";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";
import TimerOutlined from "@mui/icons-material/TimerOutlined";
import LabelOutlined from "@mui/icons-material/LabelOutlined";
import TuneOutlined from "@mui/icons-material/TuneOutlined";
import StorefrontOutlined from "@mui/icons-material/StorefrontOutlined";
import HowToRegOutlined from "@mui/icons-material/HowToRegOutlined";
import GroupsOutlined from "@mui/icons-material/GroupsOutlined";
import DynamicFormOutlined from "@mui/icons-material/DynamicFormOutlined";
import BoltOutlined from "@mui/icons-material/BoltOutlined";
import ChecklistOutlined from "@mui/icons-material/ChecklistOutlined";
import MenuBookOutlined from "@mui/icons-material/MenuBookOutlined";
import AlternateEmailOutlined from "@mui/icons-material/AlternateEmailOutlined";
import SyncOutlined from "@mui/icons-material/SyncOutlined";

export type AdminSection =
  | "overview" | "users" | "auth" | "integrations" | "interface" | "sla" | "mailboxes" | "mail" | "labels"
  | "teams" | "custom-fields" | "checklists" | "knowledge-base" | "automations" | "customer-portal"
  | "portal-registrations" | "ticket-sync" | "probes" | "devices" | "audit";

export interface NavItem {
  id: AdminSection;
  label: string;
  /** One line: what the section is for. Shown on phones and searched. */
  description: string;
  icon: SvgIconComponent;
  /** Words an admin might type that aren't in the label ("smtp" → Integrations). */
  keywords?: string;
}

/** Rail sections grouped the way admins think about them. */
export const NAV_GROUPS: { heading: string | null; items: NavItem[] }[] = [
  {
    heading: null,
    items: [{ id: "overview", label: "Overview", description: "Health, setup and recent changes", icon: DashboardOutlined, keywords: "dashboard home status" }],
  },
  {
    heading: "People & Access",
    items: [
      { id: "users", label: "Users & Roles", description: "Accounts, roles and MFA status", icon: PeopleOutlined, keywords: "password reset technician admin readonly account" },
      { id: "auth", label: "Authentication", description: "Local login, MFA, OIDC and SAML", icon: SecurityOutlined, keywords: "sso oidc saml totp mfa login identity provider idp" },
      { id: "teams", label: "Teams", description: "Queues and who is in them", icon: GroupsOutlined, keywords: "queue routing members" },
    ],
  },
  {
    heading: "Ticketing",
    items: [
      { id: "sla", label: "SLA Policies", description: "Response and resolution targets", icon: TimerOutlined, keywords: "deadline response resolution breach" },
      { id: "labels", label: "Labels", description: "Managed ticket tags", icon: LabelOutlined, keywords: "tags colors" },
      { id: "custom-fields", label: "Custom Fields", description: "Structured data on every ticket", icon: DynamicFormOutlined, keywords: "fields schema select" },
      { id: "checklists", label: "Checklists", description: "Reusable runbooks for tickets", icon: ChecklistOutlined, keywords: "templates onboarding runbook" },
      { id: "knowledge-base", label: "Knowledge Base", description: "Articles for staff and the portal", icon: MenuBookOutlined, keywords: "kb articles docs" },
      { id: "automations", label: "Automations", description: "Rules that act on ticket events", icon: BoltOutlined, keywords: "rules triggers escalation workflow" },
      { id: "interface", label: "Interface", description: "Views everyone can switch to", icon: TuneOutlined, keywords: "legacy table datagrid" },
    ],
  },
  {
    heading: "Channels & Integrations",
    items: [
      { id: "mailboxes", label: "Mailboxes", description: "Turn inbound email into tickets", icon: EmailOutlined, keywords: "imap inbound email poll" },
      { id: "mail", label: "Mail Identities", description: "Send-from addresses and templates", icon: AlternateEmailOutlined, keywords: "from address alias template signature" },
      { id: "customer-portal", label: "Customer Portal", description: "Self-service for your contacts", icon: StorefrontOutlined, keywords: "portal csat feedback contacts" },
      { id: "portal-registrations", label: "Portal Requests", description: "Access requests to review", icon: HowToRegOutlined, keywords: "registration approve access" },
      { id: "ticket-sync", label: "Ticket Sync", description: "Jira and ConnectWise tickets", icon: SyncOutlined, keywords: "jira connectwise psa import" },
      { id: "integrations", label: "Integrations", description: "SMTP, RMM, storage, numbering", icon: CableOutlined, keywords: "smtp outbound tactical ninjaone datto s3 minio storage attachments numbering" },
    ],
  },
  {
    heading: "Infrastructure",
    items: [
      { id: "probes", label: "Probes", description: "netviz network discovery", icon: RouterOutlined, keywords: "netviz scan cidr api key" },
      { id: "devices", label: "Devices", description: "Assets and RMM references", icon: DevicesOutlined, keywords: "assets rmm serial warranty" },
      { id: "audit", label: "Audit Log", description: "Every change: who and when", icon: HistoryOutlined, keywords: "history changes log" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
export const NAV_IDS = new Set<AdminSection>(NAV_ITEMS.map((i) => i.id));

export function navItem(id: AdminSection): NavItem {
  return NAV_ITEMS.find((i) => i.id === id)!;
}

export function groupOf(id: AdminSection): string | null {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.id === id))?.heading ?? null;
}

/** Every whitespace-separated term must appear in the label, description or keywords. */
export function navMatches(item: NavItem, query: string): boolean {
  const hay = `${item.label} ${item.description} ${item.keywords ?? ""}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
}
