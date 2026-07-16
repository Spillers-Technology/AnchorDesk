import { useEffect, useState } from "react";
import {
  IconButton,
  Badge,
  Popover,
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Button,
  Divider,
  Tooltip,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import * as api from "../api/client";
import { subscribeRealtime } from "../api/realtime";

/**
 * Notification bell: a live unread badge + recent-notifications popover. Loads
 * history over REST, then stays current via the shared realtime socket so new
 * notifications appear without a refresh.
 */
export default function NotificationBell({ onOpenTicket }: { onOpenTicket?: (ticketId: number) => void }) {
  const [items, setItems] = useState<api.NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const load = () => {
    api.listNotifications().then((r) => { setItems(r.items); setUnread(r.unread); }).catch(() => {});
  };

  useEffect(() => {
    load();
    return subscribeRealtime((event) => {
      if (event.type === "notification") {
        setItems((prev) => [event.notification, ...prev].slice(0, 50));
        setUnread((u) => u + 1);
      }
    });
  }, []);

  const openItem = (n: api.NotificationItem) => {
    if (!n.readAt) {
      api.markNotificationRead(n.id).then((r) => setUnread(r.unread)).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    }
    if (n.ticketId && onOpenTicket) {
      onOpenTicket(n.ticketId);
      setAnchor(null);
    }
  };

  const markAll = () => {
    api.markAllNotificationsRead().then(() => {
      setUnread(0);
      setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    }).catch(() => {});
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton color="inherit" onClick={(e) => { setAnchor(e.currentTarget); load(); }}>
          <Badge badgeContent={unread} color="error">
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ width: 360, maxWidth: "90vw" }}>
          <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="subtitle2">Notifications</Typography>
            <Button size="small" disabled={unread === 0} onClick={markAll}>Mark all read</Button>
          </Box>
          <Divider />
          {items.length === 0 ? (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>You're all caught up.</Typography>
            </Box>
          ) : (
            <List dense sx={{ maxHeight: 420, overflowY: "auto", py: 0 }}>
              {items.map((n) => (
                <ListItemButton
                  key={n.id}
                  onClick={() => openItem(n)}
                  sx={{ bgcolor: n.readAt ? "transparent" : "action.hover" }}
                >
                  <ListItemText
                    primary={n.title}
                    secondary={`${n.body ? n.body + " · " : ""}${new Date(n.createdAt).toLocaleString()}`}
                    slotProps={{
                      primary: { sx: { fontWeight: n.readAt ? 400 : 600 }, variant: "body2" },
                      secondary: { variant: "caption" }
                    }} />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </Popover>
    </>
  );
}
