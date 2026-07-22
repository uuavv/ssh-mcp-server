import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { Logger } from "../utils/logger.js";
import { toToolError } from "../utils/tool-error.js";

function truncateOutput(output: string): string {
  const configured = Number.parseInt(process.env.MCP_MAX_OUTPUT_CHARS || "200000", 10);
  const limit = Number.isInteger(configured) && configured > 0 ? configured : 200000;
  if (output.length <= limit) return output;
  return `${output.slice(0, limit)}\n\n[output truncated: ${output.length - limit} characters omitted]`;
}

export function registerExecuteCommandTool(server: McpServer): void {
  const sshManager = SSHConnectionManager.getInstance();
  server.registerTool(
    "execute-command",
    {
      description: "Execute an arbitrary shell command on an SSH target. This can modify or destroy server data and should require user confirmation.",
      annotations: {
        title: "Execute remote shell command",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        cmdString: z.string().min(1).describe("Shell command to execute"),
        directory: z.string().optional().describe("Remote working directory"),
        connectionName: z.string().optional().describe("SSH connection name"),
        timeout: z.number().int().positive().max(3600000).optional().describe("Timeout in milliseconds"),
      },
    },
    async ({ cmdString, directory, connectionName, timeout }) => {
      try {
        const result = await sshManager.executeCommand(cmdString, directory, connectionName, { timeout });
        return { content: [{ type: "text", text: truncateOutput(result) }] };
      } catch (error: unknown) {
        const toolError = toToolError(error, "UNKNOWN_ERROR");
        Logger.handleError(toolError, "Failed to execute command");
        return {
          content: [{ type: "text", text: JSON.stringify({
            code: toolError.code,
            message: toolError.message,
            retriable: toolError.retriable,
          }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
