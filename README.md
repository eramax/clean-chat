# Clean Chat

A private, client-side AI chat interface with built-in web search, GitHub browsing, documentation lookup, and file upload — all running in your browser via the Vercel AI SDK. No backend, no server, no data leaves your browser except API calls to your LLM provider and public search/documentation APIs.

## Features

- **Chat with any OpenAI-compatible LLM** — bring your own API key (stored in localStorage)
- **Web search** — parallel search across DuckDuckGo, Wikipedia, and DDG Instant Answers
- **Web fetch** — read full pages via Jina AI reader (clean markdown output)
- **GitHub browsing** — explore repos, branches, commits (with diffs), PRs, issues, and file contents
- **Documentation lookup** — query open-source library docs via Context7
- **File upload** — PDF→markdown (via docutext, no worker needed), images (as data URL), text/code files
- **Multi-conversation** — sidebar with search, auto-title, local persistence
- **Dark/light theme**
- **Streaming responses** with reasoning display and stop button
- **Tool call cards** — collapsible UI for search results, fetched pages, GitHub data, and docs
- **No SSR, no server endpoints** — pure static site, deploy anywhere (CF Pages, Netlify, etc.)

## Project Structure

```
chat/
├── index.html              # Standalone single-file chat client (original)
├── proxy.php               # PHP CORS proxy (deployed separately)
├── mcp-search/             # MCP server for web search (opencode CLI use)
│   ├── server.js
│   └── README.md
└── web/                    # Astro + Vercel AI SDK web app
    ├── astro.config.mjs
    ├── package.json
    ├── tsconfig.json
    ├── public/
    │   └── favicon.svg
    └── src/
        ├── lib/
        │   ├── types.ts        # Shared TypeScript types
        │   ├── search.ts       # webSearch (parallel DDG/Wikipedia/Instant Answer), webFetch (Jina AI)
        │   ├── context7.ts     # context7Docs — docs lookup for open-source libraries
        │   ├── github.ts       # GitHub API tools — browse, commits, PRs, issues, files
        │   ├── files.ts        # PDF/image/text file processing
        │   ├── llm.ts          # Vercel AI SDK streamText wrapper + tool registration
        │   └── skills.ts       # Markdown skill loader (import.meta.glob)
        ├── pages/
        │   └── index.astro     # Main HTML page with Tailwind shell
        ├── scripts/
        │   └── chat.ts         # Full client logic (~1250 lines)
        ├── skills/
        │   ├── web-search.md   # Web search/fetch skill for the LLM
        │   ├── context7.md     # Documentation skill
        │   ├── files.md        # File upload skill
        │   └── github.md       # GitHub browsing skill
        └── styles/
            └── chat.css        # Tailwind v4 + custom CSS
```

## Quick Start

```bash
# Install dependencies
cd web
bun install

# Development server
bun dev

# Type-check + production build
bun run build

# Preview build output
bun preview
```

## Configuration

### LLM Provider
Add a server in the settings modal:
- **Name** — any label (used as prefix in model display)
- **Base URL** — your OpenAI-compatible endpoint
- **API Key** — stored in localStorage, never in the bundle
- **Model** — model ID

### Web Search
- Uses `https://s.emolike.net/proxy.php` as CORS proxy for DuckDuckGo
- Wikipedia searches are direct (`origin=*`)
- Web fetch uses `https://r.jina.ai/{url}` (no API key needed)

### GitHub Tools
All tools use the public GitHub REST API (unauthenticated, 60 requests/hour). File content is fetched via `raw.githubusercontent.com` (no rate limit).

### Documentation
Uses Context7 anonymous tier (200 requests/minute, no API key). Proxied through `s.emolike.net/proxy.php`.

## Tools Available to the LLM

| Tool | Description |
|------|-------------|
| `webSearch` | Parallel search across DDG/Wikipedia/Instant Answer |
| `webFetch` | Read a full page as clean markdown |
| `context7Docs` | Look up documentation for any open-source library |
| `browseRepo` | GitHub repo metadata + branches |
| `listCommits` | Recent commits with authors and dates |
| `listBranches` | All branches |
| `listPRs` | Pull requests with state filter |
| `listIssues` | Issues with labels |
| `getCommit` | Full commit details including code diff (patch) |
| `fetchFile` | Single file content via raw.githubusercontent.com |
| `fetchFiles` | Multiple files in one call |
| `listFiles` | Browse directory structure via Contents API |

## Deployment

### Cloudflare Pages
```bash
cd web
bun run build
# Deploy dist/ to Cloudflare Pages
```

The output is fully static — `dist/` can be deployed to any static host.

## Bundle Size

| Asset | Size | Gzipped |
|-------|------|---------|
| Main JS | ~359 KB | ~101 KB |
| docutext browser | 52 KB | 19 KB |
| docutext markdown | 12 KB | 5 KB |
| CSS | 28 KB | — |
| HTML | 17 KB | — |
| **Total** | **~468 KB** | **~125 KB** |

## License

MIT
