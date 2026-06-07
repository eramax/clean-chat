#!/usr/bin/env node
// mcp-search: a single-file MCP server (stdio, JSON-RPC 2.0) that exposes
// a `web_search` tool backed by DuckDuckGo + Wikipedia. No npm deps.
//
// Run:   node server.js
// Wire:  register in opencode.json as type=local, command=["node","server.js"]
//
// Protocol reference: https://modelcontextprotocol.io/specification

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------- Logging (stderr only — never stdout, MCP spec) ----------
const LOG_FILE = process.env.MCP_SEARCH_LOG || path.join(require('os').tmpdir(), 'mcp-search.log');
function log(...args) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(' ')}\n`); } catch {}
}

// ---------- CORS proxy chain (same order as the chat client) ----------
const SELF_PROXY = 'https://s.emolike.net/proxy.php';
const CORS_PROXIES = [
  { name: 'self-hosted PHP', build: url => `${SELF_PROXY}?url=${encodeURIComponent(url)}` },
  { name: 'cors.lol',        build: url => `https://api.cors.lol/?url=${encodeURIComponent(url)}` },
  { name: 'cors.syrins.tech',build: url => `https://api.cors.syrins.tech/?url=${encodeURIComponent(url)}` },
  { name: 'allorigins',      build: url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  { name: 'codetabs',        build: url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` },
];

// ---------- HTTP fetch (Node built-ins) ----------
function fetchUrl(targetUrl, { timeoutMs = 10000, maxBytes = 2_000_000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(targetUrl); } catch (e) { return reject(new Error(`bad url: ${targetUrl}`)); }
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.get(targetUrl, { headers: { 'User-Agent': 'mcp-search/1.0 (+local)', ...headers } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(fetchUrl(next, { timeoutMs, maxBytes, headers }));
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        return reject(new Error(`http ${res.statusCode}`));
      }
      const chunks = [];
      let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > maxBytes) { res.destroy(); return reject(new Error('too large')); }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function fetchViaProxies(targetUrl) {
  for (const proxy of CORS_PROXIES) {
    try {
      const proxied = proxy.build(targetUrl);
      const data = await fetchUrl(proxied);
      if (data.length < 200) {
        const lower = data.toLowerCase();
        if (lower.includes('rate limit') || lower.includes('forbidden') || lower.includes('not allowed on your plan') || lower.includes('too many requests')) continue;
      }
      if (!data.includes('result__') && !data.includes('duckduckgo')) continue;
      return data;
    } catch (e) { continue; }
  }
  return null;
}

// ---------- HTML extraction (regex; no DOM in Node stdlib) ----------
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function extractRealUrl(href) {
  if (!href) return '';
  try {
    const m = href.match(/uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
  } catch {}
  return href;
}
function extractDdgResults(html) {
  const results = [];
  const blockRe = /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bresult\b|<\/div>\s*<div[^>]*class="[^"]*nav|<\/main|$)/g;
  const titleRe = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetRe = /<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  const urlRe = /<a[^>]*class="[^"]*\bresult__url\b[^"]*"[^>]*href="([^"]*)"/i;
  let m;
  while ((m = blockRe.exec(html))) {
    const block = m[1];
    const tm = block.match(titleRe);
    const sm = block.match(snippetRe);
    if (!tm || !sm) continue;
    const title = stripTags(decodeEntities(tm[2]));
    const snippet = stripTags(decodeEntities(sm[1]));
    const um = block.match(urlRe);
    const realUrl = extractRealUrl(um ? um[1] : '') || extractRealUrl(tm[1]) || '';
    if (title && snippet && realUrl) results.push({ title, snippet, url: realUrl, source: 'DuckDuckGo' });
  }
  return results;
}

// ---------- Search backends ----------
async function ddgSearch(query) {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchViaProxies(ddgUrl);
  return html ? extractDdgResults(html) : [];
}
async function wikipediaSearch(query) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=6&srprop=snippet&origin=*`;
    const data = await fetchUrl(url, { headers: { 'User-Agent': 'mcp-search/1.0' } });
    const json = JSON.parse(data);
    const hits = json?.query?.search || [];
    return hits.map(r => ({
      title: r.title,
      snippet: stripTags(decodeEntities(r.snippet || '')),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      source: 'Wikipedia',
    })).filter(r => r.snippet);
  } catch (e) { return []; }
}
async function ddgInstantAnswer(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const data = await fetchUrl(url, { headers: { 'User-Agent': 'mcp-search/1.0' } });
    const json = JSON.parse(data);
    if (json.AbstractText && json.AbstractURL) {
      return [{ title: json.Heading || query, snippet: json.AbstractText, url: json.AbstractURL, source: 'DuckDuckGo Instant' }];
    }
    if (json.Definition && json.DefinitionURL) {
      return [{ title: query, snippet: json.Definition, url: json.DefinitionURL, source: 'DuckDuckGo Instant' }];
    }
    if (Array.isArray(json.RelatedTopics)) {
      const out = [];
      for (const t of json.RelatedTopics) {
        if (t.Topics) {
          for (const sub of t.Topics.slice(0, 3)) {
            if (sub.Text && sub.FirstURL) {
              const title = sub.Text.split(' - ')[0] || sub.Text.slice(0, 60);
              out.push({ title, snippet: sub.Text, url: sub.FirstURL, source: 'DuckDuckGo Instant' });
            }
          }
        } else if (t.Text && t.FirstURL) {
          const title = t.Text.split(' - ')[0] || t.Text.slice(0, 60);
          out.push({ title, snippet: t.Text, url: t.FirstURL, source: 'DuckDuckGo Instant' });
        }
        if (out.length >= 6) break;
      }
      return out;
    }
    return [];
  } catch { return []; }
}
async function webSearch(query, maxResults) {
  const TIMEOUT_MS = 8000;
  const settled = await Promise.race([
    Promise.all([
      ddgSearch(query).catch(() => []),
      wikipediaSearch(query).catch(() => []),
      ddgInstantAnswer(query).catch(() => []),
    ]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
  ]).catch((e) => { log('webSearch', e.message); return null; });
  if (!settled) return [];
  const [ddg, wiki, instant] = settled;
  const ddgArr = Array.isArray(ddg) ? ddg : [];
  const wikiArr = Array.isArray(wiki) ? wiki : [];
  const instantArr = Array.isArray(instant) ? instant : [];
  const seen = new Set();
  const merged = [];
  for (const r of [...ddgArr, ...wikiArr, ...instantArr]) {
    if (!r || !r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    merged.push(r);
    if (merged.length >= maxResults) break;
  }
  return merged;
}

// ---------- MCP protocol ----------
const SERVER_INFO = { name: 'mcp-search', version: '1.0.0' };
const TOOLS = [{
  name: 'web_search',
  description: 'Search the public web (DuckDuckGo primary, Wikipedia + DDG Instant Answer as fallbacks). Returns up to max_results hits with title, snippet, and URL. Use for current events, prices, recent facts, or anything after the model training cutoff.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      max_results: { type: 'number', description: 'Maximum number of results to return (default 6, max 12).', minimum: 1, maximum: 12, default: 6 },
    },
    required: ['query'],
    additionalProperties: false,
  },
}];

function send(msg) {
  const line = JSON.stringify(msg);
  process.stdout.write(line + '\n');
}
function sendResult(id, result) { send({ jsonrpc: '2.0', id, result }); }
function sendError(id, code, message, data) { send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }); }

async function handleRequest(req) {
  const { id, method, params } = req;
  log('REQ', method, id, params ? JSON.stringify(params).slice(0, 200) : '');
  try {
    if (method === 'initialize') {
      return sendResult(id, {
        protocolVersion: '2024-11-05',
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      });
    }
    if (method === 'ping') return sendResult(id, {});
    if (method === 'tools/list') return sendResult(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const { name, arguments: args = {} } = params || {};
      if (name !== 'web_search') return sendError(id, -32601, `unknown tool: ${name}`);
      const query = String(args.query || '').trim();
      if (!query) return sendError(id, -32602, 'query is required');
      const max = Math.min(12, Math.max(1, Number(args.max_results) || 6));
      const results = await webSearch(query, max);
      const text = results.length
        ? results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}  _(source: ${r.source})_`).join('\n\n')
        : `No results found for "${query}".`;
      return sendResult(id, {
        content: [{ type: 'text', text }],
        isError: results.length === 0,
      });
    }
    return sendError(id, -32601, `method not found: ${method}`);
  } catch (e) {
    log('ERR', e.stack || e.message);
    return sendError(id, -32603, e.message || 'internal error');
  }
}

const MAX_BUF = 1_048_576;
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (buf.length + chunk.length > MAX_BUF) {
    log('stdin buffer overflow, resetting');
    buf = '';
    return;
  }
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { log('parse error', line.slice(0, 200)); continue; }
    // Notifications (no id) are fire-and-forget; just acknowledge in logs.
    if (msg.id === undefined) { log('NOTIF', msg.method); continue; }
    handleRequest(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', e => { log('UNCAUGHT', e.stack || e.message); });
process.on('unhandledRejection', e => { log('UNHANDLED', (e && e.stack) || String(e)); });
log('started');
