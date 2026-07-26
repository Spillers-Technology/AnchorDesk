import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { buildTheme, DEFAULT_THEME_ID } from "../theme";
import "../index.css";
import PortalApp from "./PortalApp";
import { PortalAuthProvider } from "./PortalAuthContext";
import { readAndScrubMagicToken } from "./magicToken";

// Read and remove the one-time secret before React, auth bootstrap, or any
// optional browser integration has a chance to observe the fragment.
const initialMagicToken = readAndScrubMagicToken();
const portalTheme = buildTheme(DEFAULT_THEME_ID);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename="/portal">
    <PortalAuthProvider initialMagicToken={initialMagicToken}>
      <ThemeProvider theme={portalTheme}>
        <CssBaseline />
        <PortalApp />
      </ThemeProvider>
    </PortalAuthProvider>
  </BrowserRouter>,
);

