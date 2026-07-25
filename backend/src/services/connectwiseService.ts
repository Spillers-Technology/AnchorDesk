import { ManageAPI } from "connectwise-rest";
import { config } from "../config/config";

export interface ConnectWiseCredentials {
  server: string;
  company: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
}

/** The dependency's default logger prints the full thrown object, including
 * remote response bodies. A hostile/wrong server can echo Authorization back,
 * while its text also serializes request filters. Keep the dependency log to a
 * fixed breadcrumb; AnchorDesk records the bounded, sanitized operational error
 * at the sync/run or route boundary. */
export function safeConnectWiseLogger(
  level: string,
  _text: string,
  _meta?: unknown,
): void {
  if (level === "error") console.error("connectwise-rest request failed");
}

function normalizedCredentials(
  input: Record<string, unknown> | ConnectWiseCredentials,
): ConnectWiseCredentials {
  return {
    server: String(input.server ?? "")
      .trim()
      .replace(/\/+$/, ""),
    company: String(input.company ?? "").trim(),
    publicKey: String(input.publicKey ?? "").trim(),
    privateKey: String(input.privateKey ?? "").trim(),
    clientId: String(input.clientId ?? "").trim(),
  };
}

/**
 * Build a client for one immutable credential snapshot. Callers resolve the
 * snapshot while holding the external-account lock, then keep this client for
 * the whole operation. There is deliberately no process-global singleton: a
 * settings update in one replica must not leave another replica using cached
 * credentials on the next run.
 */
export function createCwm(
  input: Record<string, unknown> | ConnectWiseCredentials = config.cwm,
): ManageAPI {
  const credentials = normalizedCredentials(input);
  if (
    !credentials.company ||
    !credentials.server ||
    !credentials.publicKey ||
    !credentials.privateKey ||
    !credentials.clientId
  ) {
    throw new Error(
      "ConnectWise Manage credentials are not configured (CWM_* env vars missing)",
    );
  }

  return new ManageAPI({
    companyId: credentials.company,
    companyUrl: credentials.server,
    publicKey: credentials.publicKey,
    privateKey: credentials.privateKey,
    clientId: credentials.clientId,
    entryPoint: "v4_6_release",
    apiVersion: "3.0.0",
    timeout: 20000,
    retry: false,
    retryOptions: {
      retries: 4,
      minTimeout: 50,
      maxTimeout: 45000,
      randomize: true,
    },
    logger: safeConnectWiseLogger,
    debug: false,
  });
}

/** Back-compatible name; it returns a fresh client rather than a singleton. */
export function getCwm(
  input: Record<string, unknown> | ConnectWiseCredentials = config.cwm,
): ManageAPI {
  return createCwm(input);
}

export function cwmConfigured(
  input: Record<string, unknown> | ConnectWiseCredentials = config.cwm,
): boolean {
  const credentials = normalizedCredentials(input);
  return !!(
    credentials.company &&
    credentials.server &&
    credentials.publicKey &&
    credentials.privateKey &&
    credentials.clientId
  );
}
