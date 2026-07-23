import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "../utils/logger.js";

type Session = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeenAt: number;
};
type RateBucket = { minute: number; count: number };

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function safeTokenMatch(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function configureTrustedProxy(app: ReturnType<typeof createMcpExpressApp>): void {
  const value = process.env.MCP_TRUST_PROXY?.trim();
  if (!value || value === "false") return;
  if (value === "true") {
    app.set("trust proxy", true);
    return;
  }
  app.set("trust proxy", value.split(",").map((item) => item.trim()).filter(Boolean));
}

export async function startRemoteHttpServer(
  createServer: () => McpServer,
  disconnectSsh: () => void,
): Promise<void> {
  const host = process.env.MCP_HTTP_HOST || "127.0.0.1";
  const port = positiveInt("MCP_HTTP_PORT", 3000);
  const mcpPath = process.env.MCP_PATH || "/mcp";
  const bearerToken = process.env.MCP_BEARER_TOKEN || "";
  const requestsPerMinute = positiveInt("MCP_REQUESTS_PER_MINUTE", 120);
  const sessionTtlMs = positiveInt("MCP_SESSION_TTL_SECONDS", 1800) * 1000;
  const maxSessions = positiveInt("MCP_MAX_SESSIONS", 32);
  const auditLogPath = process.env.MCP_AUDIT_LOG_PATH;

  if (!mcpPath.startsWith("/") || mcpPath.includes("?")) throw new Error("MCP_PATH must be an absolute URL path such as /mcp");
  if (bearerToken.length < 32) throw new Error("MCP_BEARER_TOKEN is required in HTTP mode and must contain at least 32 characters");

  const app = createMcpExpressApp({ host });
  configureTrustedProxy(app);
  const sessions = new Map<string, Session>();
  const rateBuckets = new Map<string, RateBucket>();

  const audit = (event: Record<string, unknown>) => {
    if (!auditLogPath) return;
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
    void fs.promises.appendFile(auditLogPath, line, { mode: 0o600 }).catch((error) => {
      Logger.log(`Audit log write failed: ${(error as Error).message}`, "error");
    });
  };

  const closeSession = async (id: string, reason: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    audit({ event: "session_closed", session: id, reason });
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  };

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastSeenAt > sessionTtlMs) void closeSession(id, "idle_timeout");
    }
    const currentMinute = Math.floor(now / 60000);
    for (const [ip, bucket] of rateBuckets) {
      if (bucket.minute < currentMinute - 1) rateBuckets.delete(ip);
    }
  }, Math.min(60000, Math.max(5000, Math.floor(sessionTtlMs / 2))));
  cleanupInterval.unref();

  const guard = (req: any, res: any, next: () => void) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const minute = Math.floor(Date.now() / 60000);
    const bucket = rateBuckets.get(ip);
    if (!bucket || bucket.minute !== minute) rateBuckets.set(ip, { minute, count: 1 });
    else if (++bucket.count > requestsPerMinute) {
      audit({ event: "rate_limited", ip, method: req.method });
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    if (!safeTokenMatch(req.headers.authorization, bearerToken)) {
      audit({ event: "auth_failed", ip, method: req.method });
      res.set("WWW-Authenticate", "Bearer").status(401).json({ error: "Unauthorized" });
      return;
    }
    audit({ event: "request", ip, method: req.method, session: req.headers["mcp-session-id"] || null });
    next();
  };

  app.get("/health", (_req, res) => res.json({
    status: "ok",
    transport: "streamable-http",
    sessions: sessions.size,
    maxSessions,
    sessionTtlSeconds: Math.floor(sessionTtlMs / 1000),
  }));

  app.post(mcpPath, guard, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
        existing.lastSeenAt = Date.now();
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }
      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing MCP session" }, id: null });
        return;
      }
      if (sessions.size >= maxSessions) {
        audit({ event: "session_rejected", reason: "capacity", sessions: sessions.size });
        res.status(503).json({ jsonrpc: "2.0", error: { code: -32001, message: "MCP session capacity reached" }, id: null });
        return;
      }

      let transport!: StreamableHTTPServerTransport;
      const server = createServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, lastSeenAt: Date.now() });
          audit({ event: "session_initialized", session: id });
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
        void server.close().catch(() => undefined);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      Logger.log(`HTTP MCP request failed: ${(error as Error).message}`, "error");
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  const sessionHandler = async (req: any, res: any) => {
    const id = req.headers["mcp-session-id"] as string | undefined;
    const session = id ? sessions.get(id) : undefined;
    if (!session) {
      res.status(400).send("Invalid or missing MCP session");
      return;
    }
    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(req, res);
  };
  app.get(mcpPath, guard, sessionHandler);
  app.delete(mcpPath, guard, sessionHandler);

  const httpServer = app.listen(port, host, () => {
    Logger.log(`Remote MCP listening on {{http://${host}}}:${port}${mcpPath}`, "info");
    Logger.log("Terminate TLS in Caddy/Nginx; never expose this endpoint without HTTPS.", "info");
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(cleanupInterval);
    Logger.log(`Received ${signal}, shutting down remote MCP...`, "info");
    for (const id of [...sessions.keys()]) await closeSession(id, "server_shutdown");
    disconnectSsh();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
