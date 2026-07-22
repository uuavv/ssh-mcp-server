import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { toToolError } from "../utils/tool-error.js";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function registerWriteFileTool(server: McpServer): void {
  const ssh = SSHConnectionManager.getInstance();
  server.registerTool(
    "write-file",
    {
      description: "Atomically create or replace a file on an SSH target. This is a destructive operation.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        path: z.string().min(1).describe("Absolute remote file path"),
        content: z.string().max(350000).describe("UTF-8 text or base64 data"),
        encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
        mode: z.string().regex(/^[0-7]{3,4}$/).optional().describe("Optional octal mode, e.g. 0644"),
        createParents: z.boolean().default(false),
        connectionName: z.string().optional(),
      },
    },
    async ({ path, content, encoding, mode, createParents, connectionName }) => {
      try {
        const payload = encoding === "base64"
          ? Buffer.from(content, "base64").toString("base64")
          : Buffer.from(content, "utf8").toString("base64");
        const script = "import base64,os,pathlib,sys,tempfile;p=pathlib.Path(sys.argv[1]);d=base64.b64decode(sys.argv[2],validate=True);mode=sys.argv[3];parents=sys.argv[4]=='1';\nif parents:p.parent.mkdir(parents=True,exist_ok=True)\nfd,tmp=tempfile.mkstemp(prefix='.__mcp-',dir=str(p.parent));os.write(fd,d);os.fsync(fd);os.close(fd);\nif mode:os.chmod(tmp,int(mode,8))\nos.replace(tmp,p);print(f'wrote {len(d)} bytes to {p}')";
        const command = `python3 -c ${quote(script)} ${quote(path)} ${quote(payload)} ${quote(mode || "")} ${createParents ? "1" : "0"}`;
        const result = await ssh.executeCommand(command, undefined, connectionName);
        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        const toolError = toToolError(error, "WRITE_FILE_FAILED");
        return { content: [{ type: "text", text: toolError.message }], isError: true };
      }
    },
  );
}
