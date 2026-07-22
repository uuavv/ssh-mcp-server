import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSHConnectionManager } from "../services/ssh-connection-manager.js";
import { CommandLineParser } from "../cli/command-line-parser.js";
import { Logger } from "../utils/logger.js";
import { registerAllTools } from "../tools/index.js";
import { SERVER_CONFIG } from "../config/server.js";
import { startRemoteHttpServer } from "./remote-http-server.js";

export type McpTransportMode = "stdio" | "http";

export class SshMcpServer {
  private readonly sshManager = SSHConnectionManager.getInstance();

  constructor(private readonly transportMode: McpTransportMode = "stdio") {}

  private createServer(): McpServer {
    const server = new McpServer(SERVER_CONFIG);
    registerAllTools(server);
    return server;
  }

  private logSecurityWarnings(configs: ReturnType<typeof CommandLineParser.parseArgs>["configs"]): void {
    const allConfigs = Object.values(configs);
    if (allConfigs.some((config) => !config.commandWhitelist?.length)) {
      Logger.log(
        "SECURITY WARNING: at least one SSH target has no command whitelist. This grants the MCP client arbitrary command execution as that SSH user.",
        "info",
      );
    }
    if (allConfigs.some((config) => !config.allowedRemotePaths?.length)) {
      Logger.log("SECURITY WARNING: at least one SSH target has unrestricted remote paths.", "info");
    }
  }

  private preConnect(enabled: boolean): void {
    if (!enabled) return;
    Logger.log("Pre-connecting to all configured SSH servers...", "info");
    void this.sshManager.connectAll().catch((error) => {
      Logger.log(`Pre-connect failed: ${(error as Error).message}`, "error");
    });
  }

  private registerStdioShutdown(server: McpServer): void {
    let shuttingDown = false;
    const shutdown = async (reason: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      Logger.log(`Received ${reason}, shutting down...`, "info");
      this.sshManager.disconnect();
      await server.close().catch(() => undefined);
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.stdin.resume();
    process.stdin.once("end", () => void shutdown("stdin end"));
    process.stdin.once("close", () => void shutdown("stdin close"));
  }

  public async run(): Promise<void> {
    const parsedArgs = CommandLineParser.parseArgs();
    this.sshManager.setConfig(parsedArgs.configs);
    this.logSecurityWarnings(parsedArgs.configs);
    this.preConnect(parsedArgs.preConnect);

    if (this.transportMode === "http") {
      await startRemoteHttpServer(
        () => this.createServer(),
        () => this.sshManager.disconnect(),
      );
      return;
    }

    const server = this.createServer();
    this.registerStdioShutdown(server);
    await server.connect(new StdioServerTransport());
    Logger.log("MCP stdio connection established");
  }
}
