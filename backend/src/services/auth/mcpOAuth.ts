import { config } from '../../config/config';
import { MCP_SCOPE } from './oauthProvider';

const MCP_RESOURCE_PATH = '/mcp/sse';
const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

export interface McpProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_name: string;
}

function publicUrl(path: string): string {
  return `${config.appBaseUrl}${path}`;
}

export function mcpResourceUrl(): string {
  return publicUrl(MCP_RESOURCE_PATH);
}

export function mcpProtectedResourceMetadataUrl(): string {
  return publicUrl(PROTECTED_RESOURCE_METADATA_PATH);
}

export function mcpWwwAuthenticateHeader(): string {
  return `Bearer realm="anchordesk-mcp", resource_metadata="${mcpProtectedResourceMetadataUrl()}"`;
}

/**
 * Advertise AnchorDesk itself as the authorization server (see oauthProvider.ts),
 * rather than delegating to the OIDC issuer. Self-hosting the AS is what lets MCP
 * clients like ChatGPT complete OAuth via Dynamic Client Registration — which few
 * external IdPs allow — and it keeps the resource + authorization servers on one
 * origin, which is what these clients expect.
 */
export function buildMcpProtectedResourceMetadata(): McpProtectedResourceMetadata {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [config.appBaseUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: [MCP_SCOPE],
    resource_name: 'AnchorDesk MCP',
  };
}
