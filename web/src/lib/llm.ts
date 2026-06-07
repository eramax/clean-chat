import { streamText, tool, type CoreMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { webSearch, webFetch } from './search';
import { context7Docs } from './context7';
import { getRepoInfo, listBranches, listCommits, listPRs, listIssues, fetchFile, fetchFiles, listFiles, getCommit } from './github';
import { buildSystemPrompt } from './skills';
import type { Server } from './types';

export type { CoreMessage };

export interface StreamCallbacks {
  onText: (chunk: string) => void;
  onReasoning: (chunk: string) => void;
  onToolCall: (toolName: string, args: unknown) => void;
  onToolResult: (toolName: string, result: unknown) => void;
  onError: (err: Error) => void;
}

export type { StreamCallbacks as LlmStreamCallbacks };

export interface StreamHandle {
  abort: () => void;
  promise: Promise<void>;
}

export function streamChat(
  server: Server,
  messages: CoreMessage[],
  callbacks: StreamCallbacks,
  externalSignal: AbortSignal,
): StreamHandle {
  const abortController = new AbortController();
  const onExternalAbort = () => abortController.abort();
  externalSignal.addEventListener('abort', onExternalAbort);

  const promise = (async () => {
    try {
      const provider = createOpenAICompatible({
        baseURL: server.baseUrl,
        apiKey: server.apiKey || 'no-key',
        name: 'clean-chat',
      });

      const result = streamText({
        model: provider.chatModel(server.model),
        messages,
        system: buildSystemPrompt(),
        abortSignal: abortController.signal,
        maxSteps: 5,
        tools: {
          webSearch: tool({
            description:
              'Search the web for current information, recent events, news, facts you are not sure about, or anything that benefits from up-to-date data. Returns a list of results with title, snippet, url, and source. Snippets are short — use webFetch to read the full page if you need details.',
            parameters: z.object({
              query: z.string().describe('The search query, phrased as a concise keyword string.'),
              maxResults: z
                .number()
                .int()
                .min(1)
                .max(8)
                .optional()
                .describe('Maximum number of results to return (1-8). Defaults to 5.'),
            }),
            execute: async ({ query, maxResults }) => {
              const results = await webSearch(query);
              return { results: results.slice(0, maxResults ?? 5) };
            },
          }),
          webFetch: tool({
            description:
              'Fetch the full text content of a URL. Use this AFTER webSearch to read the actual page (release notes, articles, docs). HTML is stripped to plain text. Truncated to ~12000 chars. Do NOT use for binary files.',
            parameters: z.object({
              url: z.string().url().describe('The absolute URL to fetch (http or https).'),
            }),
            execute: async ({ url }) => {
              const content = await webFetch(url);
              return { url, content };
            },
          }),
          context7Docs: tool({
            description:
              'Get up-to-date documentation, code examples, and usage guides for any open-source library or framework. Provide a library name (e.g., "react", "next.js", "express", "tailwindcss", "prisma") and a specific question about how to use it. Returns the most relevant documentation snippets and code examples with source URLs. Use this INSTEAD of webSearch when you need accurate, structured documentation about a known library.',
            parameters: z.object({
              libraryName: z.string().describe('The library or framework name to look up (e.g., "react", "next.js", "express", "tailwindcss", "prisma", "pandas", "axios"). Be as specific as possible.'),
              question: z.string().describe('Your specific question or task about the library (e.g., "How do I use middleware for authentication?", "How to handle file uploads?").'),
            }),
            execute: async ({ libraryName, question }) => {
              const content = await context7Docs(libraryName, question);
              return { content };
            },
          }),
          browseRepo: tool({
            description: 'Get repository metadata (description, stars, language, topics) and list branches for a public GitHub repo.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
            }),
            execute: async ({ owner, repo }) => getRepoInfo(owner, repo),
          }),
          listBranches: tool({
            description: 'List all branches in a public GitHub repository.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
            }),
            execute: async ({ owner, repo }) => listBranches(owner, repo),
          }),
          listCommits: tool({
            description: 'List recent commits for a public GitHub repository.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
              branch: z.string().optional().describe('Branch name (defaults to default branch)'),
              limit: z.number().int().min(1).max(30).optional().describe('Max commits to return (default 10, max 30)'),
            }),
            execute: async ({ owner, repo, branch, limit }) => listCommits(owner, repo, branch, limit),
          }),
          listPRs: tool({
            description: 'List pull requests for a public GitHub repository.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
              state: z.enum(['open', 'closed', 'all']).optional().describe('PR state (default "open")'),
              limit: z.number().int().min(1).max(30).optional().describe('Max PRs to return (default 10, max 30)'),
            }),
            execute: async ({ owner, repo, state, limit }) => listPRs(owner, repo, state, limit),
          }),
          listIssues: tool({
            description: 'List issues for a public GitHub repository.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
              state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state (default "open")'),
              limit: z.number().int().min(1).max(30).optional().describe('Max issues to return (default 10, max 30)'),
            }),
            execute: async ({ owner, repo, state, limit }) => listIssues(owner, repo, state, limit),
          }),
          getCommit: tool({
            description: 'Fetch a specific commit with full details: message, author, date, file changes, stats, and code diff (patch). Use the SHA from listCommits.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
              ref: z.string().describe('Commit SHA (full or short hash)'),
            }),
            execute: async ({ owner, repo, ref }) => getCommit(owner, repo, ref),
          }),
          fetchFile: tool({
            description: 'Fetch a single file from a public GitHub repository via raw.githubusercontent.com. Use for reading source files, configs, READMEs. Branch defaults to main (falls back to master).',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
              path: z.string().describe('File path within the repo (e.g. "src/index.ts" or "README.md")'),
              branch: z.string().optional().describe('Branch name (defaults to main, falls back to master)'),
            }),
            execute: async ({ owner, repo, path, branch }) => fetchFile(owner, repo, path, branch),
          }),
          fetchFiles: tool({
            description: 'Fetch multiple files at once from a public GitHub repository. More efficient than calling fetchFile repeatedly. Pass an array of file paths.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
              paths: z.array(z.string()).describe('Array of file paths to fetch (e.g. ["src/index.ts", "package.json", "README.md"])'),
              branch: z.string().optional().describe('Branch name (defaults to main, falls back to master)'),
            }),
            execute: async ({ owner, repo, paths, branch }) => fetchFiles(owner, repo, paths, branch),
          }),
          listFiles: tool({
            description: 'List files and directories in a GitHub repository path. Root by default. Use this to explore the repo structure, then fetchFile to read specific files.',
            parameters: z.object({
              owner: z.string().describe('Repository owner (user or organization)'),
              repo: z.string().describe('Repository name'),
              path: z.string().optional().describe('Directory path within the repo (e.g. "src/components" or "lib"). Empty for root.'),
            }),
            execute: async ({ owner, repo, path }) => listFiles(owner, repo, path),
          }),
        },
      });

      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case 'text-delta':
            callbacks.onText(chunk.textDelta);
            break;
          case 'reasoning':
            callbacks.onReasoning(chunk.textDelta);
            break;
          case 'tool-call':
            callbacks.onToolCall(chunk.toolName, chunk.args);
            break;
          case 'tool-result':
            callbacks.onToolResult(chunk.toolName, chunk.result);
            break;
          case 'error':
            callbacks.onError((chunk as { error: unknown }).error as Error);
            break;
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  })();

  return {
    abort: () => abortController.abort(),
    promise,
  };
}
