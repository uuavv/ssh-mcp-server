# 通过 Notion 管理私人服务器

本项目提供带 Bearer Token 认证的 MCP Streamable HTTP 传输，可作为 Notion Custom Agent 与私人服务器之间的受控执行桥梁。

Notion 连接地址：

```text
https://你的域名/mcp
```

## 改造后的能力

- `describe-environment`：先读取目标服务器的连接状态、OS、CPU、内存、磁盘、GPU、进程和服务概况，便于 Notion 在执行前规划。
- `list-servers`：查看可用目标与连接状态。
- `read-file` / `write-file`：读取及原子写入远程文件。
- `upload` / `download`：在 MCP 容器与 SSH 目标之间传输文件。
- `execute-command`：执行远程 Shell 命令；被标记为破坏性工具，应保留用户确认。
- HTTP 会话具有空闲 TTL、最大并发会话数、定时清理、按真实客户端 IP 限流和审计。

这已经接近“Notion 调用用户自有 Runner”，但仍不是持续交互式终端。复杂任务应遵循：

```text
describe-environment -> 读取/检查 -> 用户确认 -> 修改 -> 验证
```

## 推荐架构

```text
Notion Custom Agent -> HTTPS/Caddy -> 127.0.0.1:3000/mcp -> SSH -> ai-ops@私人服务器
```

不要把 3000 端口直接暴露到公网。HTTP 模式会拒绝没有 Bearer Token 的请求，但公网仍必须使用 HTTPS。

## 部署

1. 在服务器创建独立账号 `ai-ops`，配置仅用于 MCP 的 SSH 密钥。不要默认使用 root。
2. 复制配置：

```bash
cp .env.example .env
mkdir -p deploy logs
cp deploy/servers.example.json deploy/servers.json
openssl rand -hex 32
```

3. 把随机值写入 `.env` 的 `MCP_BEARER_TOKEN`，把私钥放到 `deploy/id_ed25519` 并执行：

```bash
chmod 600 deploy/id_ed25519
```

4. 修改 `deploy/servers.json`。若使用 Linux 的 `network_mode: host`，容器可通过 `127.0.0.1:22` 连接宿主机。
5. 启动并检查：

```bash
docker compose up -d --build
docker compose logs -f ssh-mcp
curl http://127.0.0.1:3000/health
```

6. 安装 Caddy，把 `Caddyfile.example` 中的域名替换为你的域名，然后重载 Caddy。安全组只开放 22（建议限制来源）、80 和 443，不开放 3000。
7. 在 Notion Custom Agent 的 MCP 连接中填写 `https://你的域名/mcp`，认证选择 Bearer Token，并填入 `.env` 中的同一个 Token。

## Notion 推荐配置

```dotenv
MCP_SESSION_TTL_SECONDS=1800
MCP_MAX_SESSIONS=32
MCP_TRUST_PROXY=loopback
MCP_REQUESTS_PER_MINUTE=120
```

- `MCP_SESSION_TTL_SECONDS`：无活动会话自动回收时间。
- `MCP_MAX_SESSIONS`：并发 MCP 会话上限，达到上限时新会话返回 503。
- `MCP_TRUST_PROXY`：Caddy 与 MCP 同机时使用 `loopback`；不要在可被公网直连时设置为 `true`。
- `/health`：无需认证，仅返回传输状态、当前会话数、会话上限和 TTL，不返回 SSH 主机详情。

## 权限模型

“控制整个服务器”不需要让 MCP 进程本身成为 root；真正权限来自 SSH 账号。

- 默认使用 `ai-ops` 普通用户。
- 只为确实需要的命令配置 `/etc/sudoers.d/ai-ops`，不要配置无条件 `NOPASSWD: ALL`。
- 用 `commandWhitelist`、`commandBlacklist`、`allowedRemotePaths` 逐步收紧。
- 没有白名单即允许该 SSH 用户执行任意 Shell。
- `execute-command`、`write-file`、`upload` 应在 Notion 中保留人工确认。

## 审计与轮换

- 审计日志默认写入 `/var/log/ssh-mcp/audit.jsonl`，记录认证失败、限流、会话创建/关闭与请求元数据，不记录 Token 和请求正文。
- 定期轮换 Bearer Token 与 SSH 密钥。
- 在执行升级、删除、磁盘和防火墙操作前创建云快照或 Git 检查点。

## 更新

```bash
git pull
docker compose up -d --build
```
