import { AuthSetting } from '@prisma/client';
import { config } from '../../config/config';

const MCP_RESOURCE_PATH = '/mcp/sse';
const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

type McpOAuthSettings = Pick<AuthSetting, 'oidcEnabled' | 'oidcIssuerUrl'>;

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

export function buildMcpProtectedResourceMetadata(settings: McpOAuthSettings): McpProtectedResourceMetadata {
  if (!settings.oidcEnabled || !settings.oidcIssuerUrl) {
    throw new Error('OIDC must be enabled before MCP OAuth metadata can be advertised');
  }

  return {
    resource: mcpResourceUrl(),
    authorization_servers: [settings.oidcIssuerUrl.replace(/\/$/, '')],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email'],
    resource_name: 'AnchorDesk MCP',
  };
}
