import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";

export function registerDescribeEnvironmentTool(server: McpServer): void {
  const ssh = SSHConnectionManager.getInstance();
  server.registerTool(
    "describe-environment",
    {
      description: "Inspect a configured private server before planning work. Returns connection state plus collected OS, CPU, memory, disk, GPU, process, and service metadata without exposing credentials.",
      annotations: {
        title: "Describe private server environment",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        connectionName: z.string().optional().describe("SSH connection name; defaults to the first configured server"),
      },
    },
    async ({ connectionName }) => {
      const servers = ssh.getAllServerInfos();
      const selected = connectionName
        ? servers.find((item) => item.name === connectionName)
        : servers[0];

      if (!selected) {
        const message = connectionName
          ? `Unknown SSH connection: ${connectionName}`
          : "No SSH servers configured.";
        return { content: [{ type: "text", text: message }], isError: true };
      }

      const profile = {
        name: selected.name,
        connected: selected.connected,
        endpoint: {
          host: selected.host,
          port: selected.port,
          username: selected.username,
        },
        environment: selected.status ?? null,
        guidance: selected.connected
          ? "Environment metadata is available for planning. Use read-only tools before requesting a mutating command."
          : "The target is configured but disconnected. A later SSH-backed tool call may establish the connection.",
      };

      return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
    },
  );
}
