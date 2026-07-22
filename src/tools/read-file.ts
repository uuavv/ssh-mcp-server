import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { toToolError } from "../utils/tool-error.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function registerReadFileTool(server: McpServer): void {
  const ssh = SSHConnectionManager.getInstance();
  server.registerTool(
    "read-file",
    {
      description: "Read a UTF-8 or binary file from an SSH target. Binary data is returned as base64.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        path: z.string().min(1).describe("Absolute remote file path"),
        connectionName: z.string().optional(),
        maxBytes: z.number().int().positive().max(1000000).default(200000),
      },
    },
    async ({ path, connectionName, maxBytes }) => {
      const script = "import base64,json,pathlib,sys;p=pathlib.Path(sys.argv[1]);n=int(sys.argv[2]);d=p.read_bytes();assert len(d)<=n, f'file too large: {len(d)} bytes > {n}';\ntry:o={'path':str(p),'size':len(d),'encoding':'utf-8','content':d.decode('utf-8')}\nexcept UnicodeDecodeError:o={'path':str(p),'size':len(d),'encoding':'base64','content':base64.b64encode(d).decode()}\nprint(json.dumps(o,ensure_ascii=False))";
      try {
        const result = await ssh.executeCommand(`python3 -c ${quote(script)} ${quote(path)} ${maxBytes}`, undefined, connectionName);
        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        const toolError = toToolError(error, "UNKNOWN_ERROR");
        return { content: [{ type: "text", text: toolError.message }], isError: true };
      }
    },
  );
}
