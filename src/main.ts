import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { encode } from "@toon-format/toon";

type ToolCallResponse = Awaited<ReturnType<Client["callTool"]>>;
type StandardToolResult = Extract<ToolCallResponse, { content: unknown }>;

function isStandardToolResult(result: ToolCallResponse): result is StandardToolResult {
  return "content" in result && Array.isArray(result.content);
}

function parseJsonEnvironment<T>(name: string, fallback: T): T {
  const value = process.env[name];
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

function getUpstreamArgs(): string[] {
  const args = parseJsonEnvironment<unknown>("MCP_UPSTREAM_ARGS", []);
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("MCP_UPSTREAM_ARGS must be a JSON array of strings");
  }
  return args;
}

function getUpstreamEnv(): Record<string, string> {
  const env = parseJsonEnvironment<unknown>("MCP_UPSTREAM_ENV", {});
  if (
    typeof env !== "object" ||
    env === null ||
    Array.isArray(env) ||
    Object.values(env).some((value) => typeof value !== "string")
  ) {
    throw new Error("MCP_UPSTREAM_ENV must be a JSON object with string values");
  }

  return env as Record<string, string>;
}

function convertJsonText(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return undefined;
    return encode(value);
  } catch {
    return undefined;
  }
}

function convertToolResult(result: StandardToolResult): StandardToolResult {
  const { content, structuredContent, ...metadata } = result;
  const remainingContent: StandardToolResult["content"] = [];
  for (const block of content) {
    if (block.type !== "text") {
      remainingContent.push(block);
      continue;
    }

    const converted = convertJsonText(block.text);
    if (converted === undefined || structuredContent !== undefined) {
      remainingContent.push(block);
    } else {
      remainingContent.push({ ...block, text: converted });
    }
  }

  if (structuredContent !== undefined) {
    const toonText = encode(structuredContent);
    const withoutDuplicateJson: StandardToolResult["content"] = [];
    for (const block of remainingContent) {
      if (block.type !== "text" || convertJsonText(block.text) === undefined) {
        withoutDuplicateJson.push(block);
      }
    }
    withoutDuplicateJson.unshift({ type: "text", text: toonText });
    return { ...metadata, content: withoutDuplicateJson };
  }

  return { ...metadata, content: remainingContent };
}

async function main(): Promise<void> {
  const command = process.env.MCP_UPSTREAM_COMMAND;
  if (!command) throw new Error("MCP_UPSTREAM_COMMAND is required");

  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const cwd = process.env.MCP_UPSTREAM_CWD;
  const upstreamTransport = new StdioClientTransport({
    command,
    args: getUpstreamArgs(),
    env: { ...inheritedEnv, ...getUpstreamEnv() },
    stderr: "inherit",
    ...(cwd ? { cwd } : {}),
  });
  const upstream = new Client({ name: "toon-wrapper-upstream", version: "1.0.0" });
  await upstream.connect(upstreamTransport);

  const server = new Server(
    { name: "mcp-toon-wrapper", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const cursor = request.params?.cursor;
    const upstreamTools = await upstream.listTools(
      cursor ? { cursor } : undefined,
    );
    return {
      ...upstreamTools,
      tools: upstreamTools.tools.map((tool) => {
        const { outputSchema, ...proxyTool } = tool;
        return proxyTool;
      }),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await upstream.callTool(request.params);
    return isStandardToolResult(result) ? convertToolResult(result) : result;
  });

  const serverTransport = new StdioServerTransport();
  await server.connect(serverTransport);

  let isClosing = false;
  const close = async () => {
    if (isClosing) return;
    isClosing = true;
    await Promise.allSettled([server.close(), upstream.close()]);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void close().finally(() => process.exit(0));
    });
  }
}

void main().catch((error: unknown) => {
  console.error("MCP TOON wrapper failed:", error);
  process.exitCode = 1;
});
