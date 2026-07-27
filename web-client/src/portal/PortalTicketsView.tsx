import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RefreshIcon from "@mui/icons-material/Refresh";
import * as portalApi from "./api";
import { usePortalAuth } from "./PortalAuthContext";
import { formatPortalDate } from "./format";
import PortalTicketChips from "./PortalTicketChips";
import type { PortalTicketPage } from "./types";

const PAGE_SIZE = 20;

function pageFrom(searchParams: URLSearchParams): number {
  const value = Number(searchParams.get("page") ?? "1");
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export default function PortalTicketsView() {
  const { refresh: refreshAuth } = usePortalAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = pageFrom(searchParams);
  const [result, setResult] = useState<PortalTicketPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setResult(await portalApi.listPortalTickets(page, PAGE_SIZE));
    } catch (loadError) {
      if (portalApi.isPortalAuthError(loadError)) {
        await refreshAuth();
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [page, refreshAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    setSearchParams(next);
  };

  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { xs: "stretch", sm: "center" } }}
      >
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography component="h1" variant="h4">My tickets</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            Requests submitted with your contact email.
          </Typography>
        </Box>
        <Button
          component={RouterLink}
          to="/tickets/new"
          variant="contained"
          startIcon={<AddIcon />}
          sx={{ minHeight: 44 }}
        >
          New request
        </Button>
      </Stack>

      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          Your tickets could not be loaded. Please try again.
        </Alert>
      )}

      {loading && !result ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          <CircularProgress aria-label="Loading tickets" />
        </Box>
      ) : result && result.items.length > 0 ? (
        <Stack spacing={1.5}>
          {result.items.map((ticket) => (
            <Card key={ticket.id}>
              <CardActionArea
                component={RouterLink}
                to={`/tickets/${ticket.id}`}
                sx={{ minHeight: 96 }}
              >
                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                  <Stack spacing={1.25}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
                    >
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {ticket.ticketNumber ? `#${ticket.ticketNumber}` : "Support request"}
                        </Typography>
                        <Typography
                          component="h2"
                          variant="subtitle1"
                          sx={{ overflowWrap: "anywhere" }}
                        >
                          {ticket.title || ticket.summary}
                        </Typography>
                      </Box>
                      <PortalTicketChips status={ticket.status} priority={ticket.priority} />
                    </Stack>
                    <Divider />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Updated {formatPortalDate(ticket.updatedAt)}
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}

          {result.total > result.pageSize && (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", justifyContent: "space-between", pt: 1 }}
            >
              <Button
                startIcon={<ArrowBackIcon />}
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
                sx={{ minHeight: 44 }}
              >
                Previous
              </Button>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Page {Math.min(page, pageCount)} of {pageCount}
              </Typography>
              <Button
                endIcon={<ArrowForwardIcon />}
                disabled={page >= pageCount || loading}
                onClick={() => setPage(page + 1)}
                sx={{ minHeight: 44 }}
              >
                Next
              </Button>
            </Stack>
          )}
        </Stack>
      ) : !loading && !error ? (
        <Card>
          <CardContent sx={{ p: { xs: 2.5, sm: 4 }, textAlign: "center" }}>
            <Stack spacing={1.5} sx={{ alignItems: "center" }}>
              <Typography variant="h6">No tickets yet</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                When you need help, submit a request here and follow its progress.
              </Typography>
              <Button
                component={RouterLink}
                to="/tickets/new"
                variant="contained"
                startIcon={<AddIcon />}
                sx={{ minHeight: 44 }}
              >
                Submit a request
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}

