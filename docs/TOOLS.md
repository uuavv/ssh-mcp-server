# MCP tools reference

Chinese version: [TOOLS_CN.md](TOOLS_CN.md)

## `describe-environment`

Read-only preflight inspection for a configured SSH target.

Input:

```json
{ "connectionName": "prod" }
```

If `connectionName` is omitted, the first configured target is selected. The response contains the target name, connection state, non-secret endpoint metadata, collected environment status, and planning guidance. Credentials are never returned.

## `list-servers`

Lists configured targets and their current connection/status information.

```json
{}
```

## `read-file`

Reads a remote UTF-8 or binary file. Binary data is returned as base64.

```json
{
  "path": "/srv/app/config.json",
  "connectionName": "prod",
  "maxBytes": 200000
}
```

The maximum accepted `maxBytes` value is 1,000,000. Remote path restrictions still apply.

## `write-file`

Atomically replaces a remote file. This is a mutating operation and should require confirmation.

```json
{
  "path": "/srv/app/config.json",
  "content": "{\n  \"enabled\": true\n}\n",
  "connectionName": "prod"
}
```

## `upload`

Uploads a file from the MCP host to a remote target. Local and remote path policies apply. This tool requires SFTP and is unavailable for connections using `transportMode: "shell"`.

## `download`

Downloads a remote file to the MCP host. Local and remote path policies apply. This tool requires SFTP and is unavailable for connections using `transportMode: "shell"`.

## `execute-command`

Executes a shell command as the configured SSH user.

```json
{
  "cmdString": "systemctl status my-app --no-pager",
  "directory": "/srv/app",
  "connectionName": "prod",
  "timeout": 30000
}
```

- `timeout` is in milliseconds and may not exceed 3,600,000.
- Output is limited by `MCP_MAX_OUTPUT_CHARS`.
- Command whitelist and blacklist rules are evaluated by the SSH connection manager.
- The tool is marked destructive, non-idempotent, and open-world.
- Keep explicit user confirmation enabled in Notion.

## Recommended Notion execution policy

1. Call `describe-environment` before environment-dependent work.
2. Prefer `list-servers`, `read-file`, and other read-only inspection first.
3. Present the intended mutation and obtain confirmation.
4. Use the narrowest mutating tool that can complete the task.
5. Verify the result with a read-only operation.
