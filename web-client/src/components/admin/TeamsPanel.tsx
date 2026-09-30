import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import GroupsOutlined from "@mui/icons-material/GroupsOutlined";
import GroupAddOutlined from "@mui/icons-material/GroupAddOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import * as api from "../../api/client";
import { useIsPhone } from "../../theme/useIsPhone";
import ConfirmDialog from "./ConfirmDialog";
import { AdminPage, EmptyState, IconTile, PanelError, PanelLoading, errText, initials, useAdminToast, useAsync } from "./kit";

export default function TeamsPanel() {
  const teams = useAsync(() => api.listTeams());
  const toast = useAdminToast();
  const [users, setUsers] = useState<api.ManagedUser[]>([]);
  const [editing, setEditing] = useState<api.Team | null | undefined>(undefined);
  const [addingMember, setAddingMember] = useState<Record<number, number | "">>({});
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const act = async (operation: () => Promise<unknown>, success: string) => {
    if (await toast.run(operation, success)) teams.reload();
  };

  if (teams.loading && !teams.data) return <PanelLoading />;
  if (teams.error) return <PanelError message={teams.error} onRetry={teams.reload} />;

  const list = teams.data ?? [];

  return (
    <AdminPage
      icon={GroupsOutlined}
      title="Teams"
      subtitle="Route tickets to queues and control team membership."
      status={list.length > 0 ? <Chip size="small" label={`${list.length} team${list.length === 1 ? "" : "s"}`} /> : undefined}
      actions={<Button variant="contained" startIcon={<GroupAddOutlined />} onClick={() => setEditing(null)}>Add team</Button>}
    >
      {list.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState icon={GroupsOutlined} title="No teams yet" action={<Button variant="contained" onClick={() => setEditing(null)}>Create a queue</Button>}>
            A team is a queue: tickets can be routed to it by hand, by mailbox or by automation, and its members see it in their filters.
          </EmptyState>
        </Paper>
      ) : (
        <Box>
          <Grid container spacing={2}>
            {list.map((team) => {
              const memberIds = new Set(team.members.map((member) => member.userId));
              const available = users.filter((user) => user.isActive && !memberIds.has(user.id));
              const tickets = team._count?.tickets ?? 0;
              return (
                <Grid key={team.id} size={{ xs: 12, lg: 6 }}>
                  <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
                    <Stack spacing={1.75} sx={{ height: "100%" }}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                        <IconTile icon={GroupsOutlined} size={38} />
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="subtitle1" component="h2" noWrap>{team.name}</Typography>
                          <Typography variant="body2" sx={{ color: "text.secondary" }}>
                            {team.description || "No description"} · {tickets} ticket{tickets === 1 ? "" : "s"}
                          </Typography>
                        </Box>
                        <Tooltip title="Edit team"><IconButton aria-label={`Edit ${team.name}`} onClick={() => setEditing(team)}><EditOutlined fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete team"><IconButton aria-label={`Delete ${team.name}`} color="error" onClick={() => setConfirmDelete({ id: team.id, name: team.name })}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                      </Stack>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="overline" component="div" sx={{ color: "text.secondary", lineHeight: 2 }}>
                          Members · {team.members.length}
                        </Typography>
                        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                          {team.members.map((member) => {
                            const name = member.user.displayName || member.user.username;
                            return (
                              <Chip
                                key={member.userId}
                                avatar={<Avatar>{initials(name)}</Avatar>}
                                label={name}
                                onDelete={() => void act(() => api.removeTeamMember(team.id, member.userId), `${name} removed from ${team.name}`)}

                              />
                            );
                          })}
                          {team.members.length === 0 && (
                            <Typography variant="body2" sx={{ color: "text.secondary" }}>No members yet — add someone below.</Typography>
                          )}
                        </Stack>
                      </Box>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                          select
                          size="small"
                          label="Add member"
                          value={addingMember[team.id] ?? ""}
                          disabled={available.length === 0}
                          onChange={(event) => setAddingMember((current) => ({ ...current, [team.id]: event.target.value === "" ? "" : Number(event.target.value) }))}
                          sx={{ minWidth: 220, flexGrow: 1 }}
                        >
                          <MenuItem value="">{available.length ? "Choose a user…" : "Everyone is already a member"}</MenuItem>
                          {available.map((user) => <MenuItem key={user.id} value={user.id}>{user.displayName || user.username} · {user.role}</MenuItem>)}
                        </TextField>
                        <Button
                          variant="outlined"
                          disabled={!addingMember[team.id]}
                          onClick={() => {
                            const userId = addingMember[team.id];
                            if (typeof userId !== "number") return;
                            const who = users.find((u) => u.id === userId);
                            void act(() => api.addTeamMember(team.id, userId), `${who?.displayName || who?.username || "Member"} added to ${team.name}`);
                            setAddingMember((current) => ({ ...current, [team.id]: "" }));
                          }}
                        >
                          Add
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete team “${confirmDelete?.name}”?`}
        body="Tickets routed to this queue keep everything else and become team-unassigned."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void act(() => api.deleteTeam(confirmDelete.id), "Team deleted");
          setConfirmDelete(null);
        }}
      />
      <TeamEditorDialog
        open={editing !== undefined}
        team={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSave={async (data) => {
          if (editing) await api.updateTeam(editing.id, data);
          else await api.createTeam(data);
          toast.notify(true, editing ? "Team saved" : `${data.name} created`);
          setEditing(undefined);
          teams.reload();
        }}
      />
    </AdminPage>
  );
}

function TeamEditorDialog({
  open,
  team,
  onClose,
  onSave,
}: {
  open: boolean;
  team: api.Team | null;
  onClose: () => void;
  onSave: (data: { name: string; description: string | null }) => Promise<void>;
}) {
  const isPhone = useIsPhone();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? "");
    setDescription(team?.description ?? "");
    setError(null);
  }, [open, team]);
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try { await onSave({ name: name.trim(), description: description.trim() || null }); }
    catch (err) { setError(errText(err)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={isPhone}>
      <DialogTitle>{team ? "Edit team" : "Add team"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <TextField label="Description" value={description} onChange={(event) => setDescription(event.target.value)} multiline minRows={3} helperText="What this queue handles, so techs route to it correctly." />
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button></DialogActions>
    </Dialog>
  );
}
