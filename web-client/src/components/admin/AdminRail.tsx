import { useState } from "react";
import {
  Box,
  ButtonBase,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import { NAV_GROUPS, NAV_ITEMS, groupOf, navItem, navMatches, type AdminSection } from "./nav";

/**
 * Admin navigation. Desktop gets a sticky rail with "find a setting"; below
 * `md` a single switcher button names the current section and opens the same
 * list in a bottom sheet — twenty sections don't fit a sideways-scrolling strip.
 */
export default function AdminRail({ active, onSelect }: { active: AdminSection; onSelect: (id: AdminSection) => void }) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("md"));
  return wide ? <Rail active={active} onSelect={onSelect} /> : <Switcher active={active} onSelect={onSelect} />;
}

function Rail({ active, onSelect }: { active: AdminSection; onSelect: (id: AdminSection) => void }) {
  const [query, setQuery] = useState("");
  return (
    <Paper
      variant="outlined"
      sx={{
        width: 248,
        flexShrink: 0,
        position: "sticky",
        top: 88,
        maxHeight: "calc(100vh - 104px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box sx={{ p: 1.5, pb: 1 }}>
        <FindField value={query} onChange={setQuery} onPick={() => {
          const first = NAV_ITEMS.find((i) => navMatches(i, query));
          if (first) { onSelect(first.id); setQuery(""); }
        }} />
      </Box>
      <Box sx={{ overflowY: "auto", pb: 1 }}>
        <NavList active={active} query={query} onSelect={(id) => { onSelect(id); setQuery(""); }} />
      </Box>
    </Paper>
  );
}

function Switcher({ active, onSelect }: { active: AdminSection; onSelect: (id: AdminSection) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = navItem(active);
  const group = groupOf(active);
  const close = () => { setOpen(false); setQuery(""); };
  const pick = (id: AdminSection) => { onSelect(id); close(); };

  return (
    <>
      <Paper variant="outlined" sx={{ width: "100%" }}>
        <ButtonBase
          onClick={() => setOpen(true)}
          aria-label="Choose admin section"
          aria-haspopup="dialog"
          sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", gap: 1, pl: 1.75, pr: 1.25, borderRadius: "inherit", minHeight: 48 }}
        >
          {/* A breadcrumb, not a second title: the panel header below names the page. */}
          <Typography variant="body2" component="div" noWrap sx={{ flexGrow: 1, minWidth: 0, color: "text.secondary" }}>
            Admin
            <Box component="span" aria-hidden sx={{ mx: 0.75, opacity: 0.6 }}>/</Box>
            {group && <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{group}<Box component="span" aria-hidden sx={{ mx: 0.75, opacity: 0.6 }}>/</Box></Box>}
            <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>{current.label}</Box>
          </Typography>
          <Stack direction="row" spacing={0.25} sx={{ alignItems: "center", color: "primary.main", flexShrink: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Sections</Typography>
            <UnfoldMoreIcon fontSize="small" />
          </Stack>
        </ButtonBase>
      </Paper>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={close}
        slotProps={{ paper: { sx: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88vh", display: "flex", flexDirection: "column" } } }}
      >
        <Box role="dialog" aria-label="Choose a section" sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: "divider", mx: "auto", mt: 1 }} />
          <Stack direction="row" sx={{ alignItems: "center", px: 2, pt: 1, pb: 1 }}>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>Admin sections</Typography>
            <IconButton aria-label="Close sections" onClick={close}><CloseIcon /></IconButton>
          </Stack>
          <Box sx={{ px: 2, pb: 1 }}>
            <FindField value={query} onChange={setQuery} onPick={() => {
              const first = NAV_ITEMS.find((i) => navMatches(i, query));
              if (first) pick(first.id);
            }} />
          </Box>
          <Box sx={{ overflowY: "auto", pb: 2 }}>
            <NavList active={active} query={query} onSelect={pick} showDescriptions />
          </Box>
        </Box>
      </Drawer>
    </>
  );
}

function FindField({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: () => void }) {
  return (
    <TextField
      fullWidth
      value={value}
      placeholder="Find a setting…"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onPick(); }
        if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); }
      }}
      slotProps={{
        input: {
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
        },
        htmlInput: { "aria-label": "Find a setting" },
      }}
    />
  );
}

function NavList({ active, query, onSelect, showDescriptions = false }: { active: AdminSection; query: string; onSelect: (id: AdminSection) => void; showDescriptions?: boolean }) {
  const theme = useTheme();
  const q = query.trim();
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: q ? g.items.filter((i) => navMatches(i, q)) : g.items }))
    .filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", px: 2.5, py: 2 }}>
        Nothing matches “{q}”.
      </Typography>
    );
  }

  return (
    <Box component="nav" aria-label="Admin sections">
      {groups.map((group) => (
        <List
          key={group.heading ?? "top"}
          dense
          disablePadding
          subheader={group.heading ? (
            <ListSubheader
              disableSticky
              sx={{ bgcolor: "transparent", lineHeight: "28px", mt: 1, px: 2.5, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              {group.heading}
            </ListSubheader>
          ) : undefined}
        >
          {group.items.map((n) => {
            const selected = active === n.id;
            const Icon = n.icon;
            return (
              <ListItemButton
                key={n.id}
                selected={selected}
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelect(n.id)}
                sx={{
                  position: "relative",
                  minHeight: showDescriptions ? 52 : 38,
                  "&.Mui-selected::before": {
                    content: '""',
                    position: "absolute",
                    left: -8,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: 2,
                    bgcolor: "primary.main",
                    boxShadow: `0 0 10px ${alpha(theme.palette.primary.main, 0.6)}`,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: selected ? "primary.main" : "text.secondary" }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={n.label}
                  secondary={showDescriptions ? n.description : undefined}
                  slotProps={{ primary: { sx: { fontWeight: selected ? 700 : 500, fontSize: 14 } } }}
                />
              </ListItemButton>
            );
          })}
        </List>
      ))}
    </Box>
  );
}
