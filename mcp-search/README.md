# mcp-search

A single-file Node.js MCP (Model Context Protocol) server that exposes a `web_search` tool, backed by DuckDuckGo with Wikipedia and the DuckDuckGo Instant Answer API as fallbacks. **No npm dependencies** — uses only Node built-ins (`http`, `https`, `url`, `fs`).

## Tools

### `web_search(query, max_results?)`

- `query` (string, required) — the search query
- `max_results` (number, optional, default 6, max 12) — how many results to return
- Returns a list of `{title, snippet, url, source}` items
- Sources, in order: DuckDuckGo HTML → Wikipedia MediaWiki API → DuckDuckGo Instant Answer

## Run standalone

```bash
node server.js
```

The server speaks JSON-RPC 2.0 over stdio, one JSON message per line. It will log to `/tmp/mcp-search.log` (override with `MCP_SEARCH_LOG` env var). It writes **only** MCP messages to stdout, never logs, per the MCP spec.

### Smoke test

```bash
(
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_search","arguments":{"query":"opencode mcp","max_results":3}}}' \
    sleep 30
) | node server.js
```

## Wire into opencode

In `~/.config/opencode/opencode.json`:

```json
"mcp": {
  "search": {
    "type": "local",
    "command": ["node", "/abs/path/to/chat/mcp-search/server.js"],
    "enabled": true
  }
}
```

Restart opencode. The `web_search` tool will appear alongside the built-in tools.

## Why DuckDuckGo?

Same search backend the chat client (`../index.html`) uses, so behavior is consistent. DuckDuckGo HTML results need a CORS proxy to be reachable from a browser, but from Node we hit the proxy directly without CORS issues. If the primary proxy (`s.emolike.net/proxy.php`) is down, the server falls through the chain: `cors.lol` → `cors.syrins.tech` → `allorigins` → `codetabs`.

## Protocol

Implements MCP protocol version `2024-11-05`. Methods handled:

- `initialize` — handshake, returns server info and capabilities
- `ping` — health check
- `tools/list` — returns the tool list
- `tools/call` — executes a tool

Notifications (`notifications/initialized`, etc.) are accepted and ignored.

Errors use standard JSON-RPC codes:
- `-32601` method/tool not found
- `-32602` invalid params
- `-32603` internal error
