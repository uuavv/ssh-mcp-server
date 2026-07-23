# MCP 工具参考

English version: [TOOLS.md](TOOLS.md)

## `describe-environment`

对指定 SSH 目标执行只读的环境预检。

输入：

```json
{ "connectionName": "prod" }
```

省略 `connectionName` 时选择第一个已配置目标。返回目标名称、连接状态、不含凭据的端点信息、已采集的环境状态和操作建议，不会返回密码或私钥。

## `list-servers`

列出已配置的 SSH 目标以及当前连接和状态信息。

```json
{}
```

## `read-file`

读取远端 UTF-8 或二进制文件，二进制内容以 Base64 返回。

```json
{
  "path": "/srv/app/config.json",
  "connectionName": "prod",
  "maxBytes": 200000
}
```

`maxBytes` 最大为 1,000,000，仍受远端路径白名单限制。

## `write-file`

原子替换远端文件。它会修改服务器，应要求用户确认。

```json
{
  "path": "/srv/app/config.json",
  "content": "{\n  \"enabled\": true\n}\n",
  "connectionName": "prod"
}
```

## `upload`

把 MCP 主机上的文件上传到 SSH 目标，受本地和远端路径策略限制。该工具依赖 SFTP，使用 `transportMode: "shell"` 的连接不可用。

## `download`

把远端文件下载到 MCP 主机，受本地和远端路径策略限制。该工具依赖 SFTP，使用 `transportMode: "shell"` 的连接不可用。

## `execute-command`

以配置的 SSH 用户身份执行 Shell 命令。

```json
{
  "cmdString": "systemctl status my-app --no-pager",
  "directory": "/srv/app",
  "connectionName": "prod",
  "timeout": 30000
}
```

- `timeout` 单位为毫秒，最大 3,600,000。
- 输出长度由 `MCP_MAX_OUTPUT_CHARS` 限制。
- 命令白名单和黑名单由 SSH 连接管理器检查。
- 该工具标记为破坏性、非幂等和开放世界操作。
- 在 Notion 中应保留明确的用户确认。

## 推荐的 Notion 执行策略

1. 涉及环境差异的任务先调用 `describe-environment`。
2. 优先使用 `list-servers`、`read-file` 等只读能力检查现状。
3. 展示计划执行的修改并获得用户确认。
4. 使用能够完成任务的最小权限工具。
5. 修改后通过只读操作验证结果。
