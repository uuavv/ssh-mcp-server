# Manage private servers from Notion

This project exposes an authenticated MCP Streamable HTTP endpoint that can be connected to a Notion Custom Agent. It acts as a controlled bridge between Notion and SSH targets owned by the user.

Chinese version: [NOTION_DEPLOYMENT_CN.md](NOTION_DEPLOYMENT_CN.md)

## Connection URL

```text
https://your-domain.example/mcp
```

## Current tool surface

| Tool | Risk | Purpose |
| --- | --- | --- |
| `describe-environment` | Read-only | Return the selected target's connection state and collected OS, CPU, memory, disk, GPU, process, and service metadata. |
| `list-servers` | Read-only | List configured SSH targets and connection state. |
| `read-file` | Read-only | Read a remote UTF-8 or binary file, subject to the configured remote-path policy. |
| `write-file` | Mutating | Atomically replace a remote file. Keep user confirmation enabled in Notion. |
| `upload` | Mutating | Upload a local file from the MCP host to an SSH target. |
| `download` | Read/write | Download a remote file to the MCP host. |
| `execute-command` | Destructive | Execute a shell command with the selected SSH user's privileges. Keep user confirmation enabled. |

Recommended agent flow:

```text
describe-environment -> inspect/read -> user confirmation -> mutate -> verify
```

## Recommended architecture

```text
Notion Custom Agent
        |
        | HTTPS + Bearer token
        v
Caddy / Nginx
        |
        | http://127.0.0.1:3000/mcp
        v
ssh-mcp-server
        |
        | SSH with a dedicated key
        v
ai-ops@private-server
```

Do not expose port `3000` directly to the internet. The MCP application requires a Bearer token, but the public endpoint must still use HTTPS.

## Quick deployment

```bash
cp .env.example .env
mkdir -p deploy logs
cp deploy/servers.example.json deploy/servers.json
openssl rand -hex 32
chmod 600 deploy/id_ed25519
```

Put the generated value in `MCP_BEARER_TOKEN`, configure `deploy/servers.json`, and start the service:

```bash
docker compose up -d --build
docker compose logs -f ssh-mcp
curl http://127.0.0.1:3000/health
```

Replace the hostname in `Caddyfile.example`, reload Caddy, then add `https://your-domain.example/mcp` as a custom MCP connection in Notion. Select Bearer Token authentication and use the token from `.env`.

## HTTP runtime settings

```dotenv
MCP_BEARER_TOKEN=replace-with-at-least-32-random-characters
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_PATH=/mcp
MCP_REQUESTS_PER_MINUTE=120
MCP_MAX_OUTPUT_CHARS=200000
MCP_AUDIT_LOG_PATH=/var/log/ssh-mcp/audit.jsonl
MCP_SESSION_TTL_SECONDS=1800
MCP_MAX_SESSIONS=32
MCP_TRUST_PROXY=loopback
```

| Variable | Meaning |
| --- | --- |
| `MCP_SESSION_TTL_SECONDS` | Close MCP sessions that have been idle for this many seconds. |
| `MCP_MAX_SESSIONS` | Reject new sessions with HTTP 503 after this limit is reached. |
| `MCP_TRUST_PROXY` | Express trusted-proxy setting. Use `loopback` when Caddy and MCP run on the same host. Do not use `true` when the app is directly reachable from untrusted networks. |
| `MCP_REQUESTS_PER_MINUTE` | Per-client-IP request limit. Client IP is derived through the trusted proxy configuration. |
| `MCP_AUDIT_LOG_PATH` | JSONL audit log for requests, authentication failures, rate limiting, and session lifecycle events. |

`GET /health` is unauthenticated and returns only transport status, current session count, maximum sessions, and session TTL. It does not expose SSH host details.

## Permission model

The effective privilege boundary is the SSH account, not the MCP container.

- Use a dedicated unprivileged account such as `ai-ops`.
- Grant only specific `sudo` commands; avoid unconditional `NOPASSWD: ALL`.
- Configure `commandWhitelist`, `commandBlacklist`, and `allowedRemotePaths`.
- No command whitelist means arbitrary shell execution as the configured SSH user.
- Keep confirmation enabled for `execute-command`, `write-file`, and `upload` in Notion.
- Rotate the Bearer token and SSH key regularly.

## Capability boundary

This service approximates a user-owned remote runner, but it is not a native Notion sandbox or an interactive terminal. The current implementation does not provide persistent asynchronous jobs, Git checkpoints, automatic rollback, code indexing, or a PTY exposed to Notion. Long operations should be split into observable, verifiable steps.

## Troubleshooting

### Notion cannot connect

1. Confirm `https://your-domain.example/health` returns JSON.
2. Confirm the MCP URL ends in `/mcp`.
3. Confirm the Bearer token exactly matches `MCP_BEARER_TOKEN`.
4. Confirm Caddy can reach `127.0.0.1:3000`.
5. Check `docker compose logs -f ssh-mcp`.

### Every request appears to come from the proxy

Set `MCP_TRUST_PROXY=loopback` when the reverse proxy is on the same host. Do not trust arbitrary proxies unless the MCP port is isolated from direct public access.

### New sessions receive HTTP 503

The server reached `MCP_MAX_SESSIONS`. Wait for idle-session cleanup, restart the service if the clients are gone, or raise the limit only after checking memory and request volume.

### SSH target is configured but disconnected

`describe-environment` can report a disconnected target. A later SSH-backed tool call may establish the connection. Verify the private-key path, permissions, SSH username, host, port, and firewall rules.
