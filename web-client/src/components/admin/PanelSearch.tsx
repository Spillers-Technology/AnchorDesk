import { InputAdornment, TextField } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

/**
 * The console-standard quick filter: client-side narrowing of an already
 * loaded panel list. Server-side search belongs to the panels that page.
 */
export default function PanelSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Filter…"}
      sx={{ maxWidth: { sm: 280 }, width: "100%" }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        },
        htmlInput: { "aria-label": placeholder ?? "Filter list" },
      }}
    />
  );
}

/** Case-insensitive match across the stringable fields of a row. */
export function rowMatches(q: string, fields: (string | null | undefined)[]): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return fields.some((f) => f != null && f.toLowerCase().includes(needle));
}
