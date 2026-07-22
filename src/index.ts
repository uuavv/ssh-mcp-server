#!/usr/bin/env node

import { SshMcpServer } from "./core/mcp-server.js";
import { SERVER_CONFIG } from "./config/server.js";
import { Logger } from "./utils/logger.js";

const HELP_TEXT = `Usage: ssh-mcp-server [options] [host port username password]

Transport:
  --http                           Run authenticated Streamable HTTP instead of stdio
                                   Environment: MCP_BEARER_TOKEN (required, 32+ chars),
                                   MCP_HTTP_HOST=127.0.0.1, MCP_HTTP_PORT=3000,
                                   MCP_PATH=/mcp, MCP_REQUESTS_PER_MINUTE=120,
                                   MCP_AUDIT_LOG_PATH=/path/audit.jsonl

SSH options:
  --config-file <path>             Load SSH server configs from a JSON file
  --ssh-config-file <path>         Read host aliases from SSH config
  --ssh <config>                   Add SSH config (repeatable)
  -h, --host <host>                SSH host or alias
  -p, --port <port>                SSH port
  -u, --username <name>            SSH username
  -w, --password <password>        SSH password (prefer key authentication)
  -k, --privateKey <path>          SSH private key path
  -P, --passphrase <passphrase>    SSH private key passphrase
  -a, --agent <path>               SSH agent socket
  -W, --whitelist <patterns>       Command whitelist regexes
  -B, --blacklist <patterns>       Command blacklist regexes
  --allowed-local-paths <paths>    Extra allowed local paths
  --allowed-remote-paths <paths>   Allowed remote absolute paths
  --pre-connect                    Connect to all targets on startup
  --version, -v                    Print version
  --help                           Print help`;

function hasArg(...names: string[]): boolean {
  return process.argv.slice(2).some((arg) => names.includes(arg));
}

async function main(): Promise<void> {
  if (hasArg("--help")) {
    console.log(HELP_TEXT);
    return;
  }
  if (hasArg("--version", "-v")) {
    console.log(SERVER_CONFIG.version);
    return;
  }

  const httpMode = hasArg("--http");
  if (httpMode) {
    process.argv = process.argv.filter((arg) => arg !== "--http");
  }
  await new SshMcpServer(httpMode ? "http" : "stdio").run();
}

main().catch((error) => Logger.handleError(error, "【SSH MCP Server Error】", true));
