import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient, resolveApiBaseUrl } from "./mcp/api-client.js";
import { buildMcpServer } from "./mcp/server.js";

// Resolved per request: the API may be started (or restarted on another port) after this process.
const server = buildMcpServer(createApiClient(resolveApiBaseUrl), { baseUrl: resolveApiBaseUrl });

await server.connect(new StdioServerTransport());
