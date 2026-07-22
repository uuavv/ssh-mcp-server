# 通过 Notion 管理云服务器

本分支增加了带 Bearer Token 认证的 MCP Streamable HTTP 传输。Notion 连接地址为：

```text
https://你的域名/mcp
```

## 能力边界

- `execute-command`：执行任意远程 Shell 命令，作用域等于 SSH 用户权限。
- `read-file` / `write-file`：读取及原子写入远程文件。
- `upload` / `download`：在 MCP 容器与 SSH 目标之间传输文件。
- `list-servers`：查看目标与连接状态。

这接近 Codex CLI 的服务器操作能力，但 Notion 不是持续交互式终端，也不会天然具备代码索引、Git 沙箱和自动回滚。复杂任务应拆成可确认、可验证的步骤。

## 推荐架构

```text
Notion Custom Agent -> HTTPS/Caddy -> 127.0.0.1:3000/mcp -> SSH -> ai-ops@127.0.0.1
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

3. 把随机值写入 `.env` 的 `MCP_BEARER_TOKEN`，把私钥放到 `deploy/id_ed25519` 并执行 `chmod 600 deploy/id_ed25519`。
4. 修改 `deploy/servers.json`。若使用 Linux 的 `network_mode: host`，容器可通过 `127.0.0.1:22` 连接宿主机。
5. 启动：

```bash
docker compose up -d --build
docker compose logs -f ssh-mcp
curl http://127.0.0.1:3000/health
```

6. 安装 Caddy，把 `Caddyfile.example` 中的域名替换为你的域名，然后重载 Caddy。确保安全组仅开放 22（建议限制来源）、80 和 443，不开放 3000。
7. 在 Notion Custom Agent 的 MCP 连接中填写 `https://你的域名/mcp`，认证选择 Bearer Token，并填入 `.env` 中的同一个 Token。

## 权限模型

“控制整个服务器”不需要让 MCP 进程本身成为 root；真正权限来自 SSH 账号。建议：

- 默认使用 `ai-ops` 普通用户。
- 只为确实需要的命令配置 `/etc/sudoers.d/ai-ops`，不要直接配置无条件 `NOPASSWD: ALL`。
- 若你坚持完整 root 能力，应明确认识到：任何被授权的 Notion 工具调用都可能读取密钥、删除数据、停止服务或接管服务器。
- 用 `commandWhitelist`、`commandBlacklist`、`allowedRemotePaths` 逐步收紧。没有白名单即表示允许任意 Shell。
- 保留 Notion 的工具确认；`execute-command` 和 `write-file` 已标记为 destructive。

## 审计与轮换

- 审计日志默认写入 `/var/log/ssh-mcp/audit.jsonl`，不记录 Token 和请求正文。
- 定期轮换 `MCP_BEARER_TOKEN` 与 SSH 密钥。
- 定期备份，并在执行升级、删除、磁盘和防火墙操作前创建快照。
- `/health` 不需要认证，只返回服务状态和会话数量，不返回服务器信息。

## 更新

```bash
git pull
docker compose up -d --build
```
