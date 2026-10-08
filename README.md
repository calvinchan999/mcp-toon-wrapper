# MCP TOON Wrapper

An independent stdio MCP proxy that forwards an upstream server's tools and converts JSON tool results to TOON text. Tool input schemas are forwarded unchanged. Output schemas are omitted because results are returned as text after conversion.

## Build

Requires Node.js 22 or later.

```powershell
cd C:\path\to\mcp-toon-wrapper
npm install
npm run build
```

## VS Code setup

In the consuming workspace, add an entry to `.vscode/mcp.json` and point `args` to this project's compiled `dist/main.js`. Replace the path and upstream command with the MCP server you want to wrap:

```json
{
  "servers": {
    "toon-filesystem": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/mcp-toon-wrapper/dist/main.js"],
      "env": {
        "MCP_UPSTREAM_COMMAND": "cmd.exe",
        "MCP_UPSTREAM_ARGS": "[\"/d\",\"/s\",\"/c\",\"npx -y @modelcontextprotocol/server-filesystem C:\\\\path\\\\to\\\\workspace\"]"
      }
    }
  }
}
```

The wrapper starts the configured upstream as a child process. Upstream arguments and environment are JSON encoded in `MCP_UPSTREAM_ARGS` and `MCP_UPSTREAM_ENV`; `MCP_UPSTREAM_CWD` optionally sets its working directory. The wrapper inherits its own environment, with `MCP_UPSTREAM_ENV` values taking precedence.

The example uses `cmd.exe` because Windows npm shims such as `npx.cmd` cannot be spawned directly with the SDK's `shell: false` behavior. Only put trusted, locally configured commands in this value; shell metacharacters are interpreted by `cmd.exe`.

This version proxies tools over stdio. It converts structured results and text blocks containing JSON objects/arrays; ordinary text and non-text content are passed through. It does not proxy upstream resources or prompts.
