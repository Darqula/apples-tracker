import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient, resolveApiBaseUrl } from "./mcp/api-client.js";
import { buildMcpServer } from "./mcp/server.js";

const baseUrl = resolveApiBaseUrl();

const server = buildMcpServer(createApiClient(baseUrl), { baseUrl });

await server.connect(new StdioServerTransport());
