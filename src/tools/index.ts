import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExecuteCommandTool } from "./execute-command.js";
import { registerUploadTool } from "./upload.js";
import { registerDownloadTool } from "./download.js";
import { registerListServersTool } from "./list-servers.js";
import { registerReadFileTool } from "./read-file.js";
import { registerWriteFileTool } from "./write-file.js";

export function registerAllTools(server: McpServer): void {
  registerExecuteCommandTool(server);
  registerReadFileTool(server);
  registerWriteFileTool(server);
  registerUploadTool(server);
  registerDownloadTool(server);
  registerListServersTool(server);
}
