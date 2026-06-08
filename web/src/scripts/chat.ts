import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import shell from 'highlight.js/lib/languages/shell';
import 'highlight.js/styles/atom-one-dark.css';

import { streamChat } from '~/lib/llm';
import type { CoreMessage } from 'ai';
import type { Message, SearchResult, Server, Conversation, AssistantMessage, SearchToolMessage, GenericToolMessage, Attachment } from '~/lib/types';
import { processFile, formatSize, fileIcon, attachmentLabel } from '~/lib/files';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('shell', shell);

const PROXY = 'https://s.emolike.net/proxy.php';

const IP_RE = /^https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[?[0-9a-f:]+\]?)(:\d+)?\//i;

async function smartFetch(url: string, headers?: Record<string, string>): Promise<Response> {
  try {
    const res = await fetch(url, { headers });
    if (res.ok || (res.status >= 400 && res.status < 500)) return res;
    throw new Error(`HTTP ${res.status}`);
  } catch (e: any) {
    if (IP_RE.test(url)) throw e;
    return fetch(`${PROXY}?url=${encodeURIComponent(url)}`, {
      headers: { ...(headers || {}), 'Accept': 'application/json, text/plain, */*' },
    });
  }
}

// === DOM ===
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const messagesEl = $('messages') as HTMLDivElement;
const inputEl = $('input') as HTMLTextAreaElement;
const sendBtn = $('send-btn') as HTMLButtonElement;
const sendIcon = $('send-icon') as unknown as SVGElement;
const recentsEl = $('recents-list') as HTMLDivElement;
const serverListEl = $('server-list') as HTMLDivElement;
const modelLabel = $('model-label') as HTMLSpanElement;
const modelDot = $('model-dot') as HTMLDivElement;
const modelDropdown = $('model-dropdown') as HTMLDivElement;
const modelListEl = $('model-list') as HTMLDivElement;
const testResultEl = $('test-result') as HTMLDivElement;
const autoscrollBtn = $('autoscroll-btn') as HTMLButtonElement;
const tokenText = $('token-text') as HTMLSpanElement;
const tokenFill = $('token-fill') as HTMLDivElement;
const sidebar = $('sidebar') as HTMLElement;
const uploadBtn = $('upload-btn') as HTMLButtonElement;
const fileInput = $('file-input') as HTMLInputElement;
const attachmentsStrip = $('attachments-strip') as HTMLDivElement;

// === STATE ===
let messages: Message[] = [];
let searchOn = true;
let codeOn = false;
let thinkingOn = false;
let generating = false;
let activeStreamAbort: (() => void) | null = null;
let servers: Server[] = [];
let activeServer = -1;
let editingIdx = -1;
let conversations: Conversation[] = [];
let currentId: string | null = null;
let startTime = 0;
let streamChunks = 0;
let editingMsgIdx = -1;
let pendingToolMessageIdx = -1;

// rAF coalescing for streaming
let streamRafId: number | null = null;

const STORAGE_KEY = 'cleanchat-servers';
const SELECTED_MODEL_KEY = 'cleanchat-selected-model';
const ACTIVE_KEY = 'cleanchat-active';
const CONV_KEY = 'cleanchat-conversations';
const CURRENT_CONV_KEY = 'cleanchat-current-conv';
const THEME_KEY = 'cleanchat-theme';
const SIDEBAR_KEY = 'cleanchat-sidebar';
const PILLS_KEY = 'cleanchat-pills';

marked.setOptions({ breaks: true, gfm: true });
const esc = (t: string): string => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
const uid = (): string => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const getDomain = (url: string): string => { try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', ''); } catch { return url; } };
const estimateTokens = (text: string | undefined): number => Math.ceil((text || '').length / 4);

// === THEME & SIDEBAR ===
function loadTheme(): void {
  const t = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.classList.toggle('light', t === 'light');
  updateThemeIcon();
}
(window as any).loadTheme = loadTheme;
(window as any).toggleTheme = function (): void {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
  updateThemeIcon();
};
function updateThemeIcon(): void {
  const isLight = document.documentElement.classList.contains('light');
  ($('theme-icon') as unknown as SVGElement).innerHTML = isLight
    ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
}
function loadSidebar(): void {
  const collapsed = localStorage.getItem(SIDEBAR_KEY) === '1';
  sidebar.classList.toggle('collapsed', collapsed);
  updateTopbarBurger();
}
function updateTopbarBurger(): void {
  const burger = $('topbar-burger');
  if (burger) burger.style.display = sidebar.classList.contains('collapsed') ? 'flex' : 'none';
}
(window as any).toggleSidebar = function (): void {
  const collapsed = sidebar.classList.toggle('collapsed');
  localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  updateTopbarBurger();
};

// === SERVERS ===
function loadServers(): void {
  try {
    servers = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    activeServer = parseInt(localStorage.getItem(ACTIVE_KEY) || '-1');
    if (activeServer >= servers.length) activeServer = servers.length - 1;
    try {
      const sel = JSON.parse(localStorage.getItem(SELECTED_MODEL_KEY) || 'null');
      if (sel && servers[sel.serverIdx] && (sel.serverIdx === activeServer || activeServer < 0)) {
        activeServer = sel.serverIdx;
        if (sel.model) servers[sel.serverIdx].model = sel.model;
      }
    } catch {}
  } catch { servers = []; activeServer = -1; }
  updateModelLabel(); renderServerList();
}
function saveServers(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  localStorage.setItem(ACTIVE_KEY, String(activeServer));
}
function saveSelectedModel(serverIdx: number, model: string): void {
  localStorage.setItem(SELECTED_MODEL_KEY, JSON.stringify({ serverIdx, model }));
}
function updateModelLabel(): void {
  if (activeServer >= 0 && servers[activeServer]) {
    const s = servers[activeServer];
    const provider = (s.name || s.baseUrl).toLowerCase();
    modelLabel.innerHTML = s.model
      ? `<span style="color: var(--muted); font-weight: 450;">${esc(provider)}:</span> ${esc(s.model)}`
      : `<span style="color: var(--muted); font-weight: 450;">${esc(provider)}</span>`;
    modelDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
  } else {
    modelLabel.textContent = 'Select model';
    modelDot.className = 'w-2 h-2 rounded-full bg-[#555]';
  }
}
(window as any).openModal = function (): void { $('settings-modal').classList.remove('hidden'); clearForm(); renderServerList(); modelDropdown.classList.add('hidden'); };
(window as any).closeModal = function (): void { $('settings-modal').classList.add('hidden'); };
function clearForm(): void {
  editingIdx = -1;
  ['srv-name','srv-url','srv-key'].forEach(id => ($(id) as HTMLInputElement).value = '');
  testResultEl.classList.add('hidden');
  $('form-title').textContent = 'ADD NEW SERVER';
  ($('srv-key') as HTMLInputElement).type = 'password';
}
function renderServerList(): void {
  if (servers.length === 0) {
    serverListEl.innerHTML = '<div class="text-sm text-center py-6" style="color: var(--muted);">No servers yet. Add one below.</div>';
    return;
  }
  serverListEl.innerHTML = servers.map((s, i) => `
    <div class="server-row ${i === activeServer ? 'active' : ''}">
      <div style="flex:1;min-width:0;cursor:pointer;" onclick="setActive(${i})">
        <div style="font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name || s.model || s.baseUrl)}</div>
        <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);">${esc(s.baseUrl.replace(/^https?:\/\//, ''))}</div>
      </div>
      <button class="icon-btn" style="width:28px;height:28px;border-radius:8px;" onclick="editServer(${i})" data-tooltip="Edit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="icon-btn" style="width:28px;height:28px;border-radius:8px;" onclick="deleteServer(${i})" data-tooltip="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `).join('');
}
(window as any).setActive = function (i: number): void { activeServer = i; saveServers(); updateModelLabel(); renderServerList(); modelDropdown.classList.add('hidden'); };
(window as any).editServer = function (i: number): void {
  editingIdx = i;
  const s = servers[i];
  ($('srv-name') as HTMLInputElement).value = s.name || '';
  ($('srv-url') as HTMLInputElement).value = s.baseUrl || '';
  ($('srv-key') as HTMLInputElement).value = s.apiKey || '';
  $('form-title').textContent = 'EDIT SERVER';
  testResultEl.classList.add('hidden');
};
(window as any).deleteServer = function (i: number): void {
  if (!confirm(`Delete "${servers[i].name || servers[i].baseUrl}"?`)) return;
  servers.splice(i, 1);
  if (activeServer >= servers.length) activeServer = servers.length - 1;
  if (activeServer < 0 && servers.length > 0) activeServer = 0;
  saveServers();
  updateModelLabel();
  renderServerList();
  renderModelDropdown();
};
(window as any).saveServer = function (): void {
  const name = ($('srv-name') as HTMLInputElement).value.trim() || ($('srv-url') as HTMLInputElement).value.trim();
  const baseUrl = ($('srv-url') as HTMLInputElement).value.trim().replace(/\/$/, '');
  const apiKey = ($('srv-key') as HTMLInputElement).value.trim();
  if (!baseUrl) { showTestResult('Base URL is required.', false); return; }
  const server: Server = { name, baseUrl, apiKey };
  if (editingIdx >= 0) { servers[editingIdx] = server; if (activeServer === editingIdx) updateModelLabel(); }
  else { servers.push(server); if (activeServer < 0) activeServer = 0; }
  saveServers();
  updateModelLabel();
  renderServerList();
  renderModelDropdown();
  clearForm();
  (window as any).closeModal();
};
(window as any).testConnection = async function (): Promise<void> {
  const baseUrl = ($('srv-url') as HTMLInputElement).value.trim().replace(/\/$/, '');
  const apiKey = ($('srv-key') as HTMLInputElement).value.trim();
  if (!baseUrl) { showTestResult('Enter a Base URL first.', false); return; }
  showTestResult('<div class="spinner"></div> Testing...', true);
  try {
    const res = await smartFetch(baseUrl + '/models', apiKey ? { 'Authorization': `Bearer ${apiKey}` } : undefined);
    if (res.ok) {
      const data = await res.json();
      const models = data.data || data.models || [];
      showTestResult(`<span style="color: var(--primary);">✓ Connected</span> · ${models.length} models`, true, 0);
    } else showTestResult(`<span style="color:#e74c3c;">✗ Error ${res.status}</span>`, true, 0);
  } catch (e: any) { showTestResult(`<span style="color:#e74c3c;">✗ ${esc(e.message)}</span>`, true, 0); }
};
function showTestResult(html: string, show: boolean, hideAfter = 0): void {
  testResultEl.innerHTML = html; testResultEl.classList.toggle('hidden', !show);
  if (hideAfter > 0) setTimeout(() => testResultEl.classList.add('hidden'), hideAfter);
}

// Model dropdown
(window as any).toggleModelDropdown = function (): void {
  modelDropdown.classList.toggle('hidden');
  if (!modelDropdown.classList.contains('hidden')) {
    renderModelDropdown();
    setTimeout(() => ($('model-search') as HTMLInputElement).focus(), 50);
  }
};
function renderModelDropdown(): void {
  if (servers.length === 0) {
    modelListEl.innerHTML = '<div class="model-dropdown-empty">No servers configured</div>';
    return;
  }
  const q = ($('model-search') as HTMLInputElement).value.toLowerCase();
  const filtered = servers.filter(s => (s.name || s.baseUrl).toLowerCase().includes(q));
  if (!filtered.length) {
    modelListEl.innerHTML = '<div class="model-dropdown-empty">No matches</div>';
    return;
  }
  modelListEl.innerHTML = filtered.map(s => {
    const i = servers.indexOf(s);
    return `<div class="model-dropdown-item ${i === activeServer ? 'selected' : ''}" onclick="setActive(${i})">
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name || s.baseUrl)}</div>
        <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);">${esc(s.baseUrl.replace(/^https?:\/\//, ''))}</div>
      </div>
    </div>`;
  }).join('');
}
(window as any).filterModelDropdown = function (_q: string): void { renderModelDropdown(); };
(window as any).closeModelDropdown = function (): void { modelDropdown.classList.add('hidden'); };

// === ALL MODELS MODAL ===
interface AllModelsEntry { serverIdx: number; serverName: string; baseUrl: string; apiKey: string; model: string; }
let allModelsCache: AllModelsEntry[] = [];
(window as any).openAllModelsModal = async function (): Promise<void> {
  if (servers.length === 0) {
    alert('No servers configured. Add a server in Settings first.');
    return;
  }
  $('all-models-modal').classList.remove('hidden');
  ($('all-models-search') as HTMLInputElement).value = '';
  $('all-models-list').innerHTML = `<div class="model-dropdown-empty" style="display:flex;align-items:center;justify-content:center;gap:10px;"><div class="spinner"></div> Fetching from ${servers.length} server${servers.length > 1 ? 's' : ''}...</div>`;
  const results = await Promise.allSettled(servers.map(async (s, i) => {
    const url = s.baseUrl.replace(/\/$/, '') + '/models';
    const headers = s.apiKey ? { 'Authorization': `Bearer ${s.apiKey}` } : undefined;
    const res = await smartFetch(url, headers);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || data.models || []).map((m: any) => m.id || m.name).filter(Boolean);
    return { serverIdx: i, serverName: s.name || s.model || `Server ${i+1}`, baseUrl: s.baseUrl, apiKey: s.apiKey, models };
  }));
  allModelsCache = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      const srv = r.value;
      srv.models.forEach((m: string) => allModelsCache.push({
        serverIdx: srv.serverIdx,
        serverName: srv.serverName,
        baseUrl: srv.baseUrl,
        apiKey: srv.apiKey,
        model: m,
      }));
    }
  });
  renderAllModels();
  setTimeout(() => ($('all-models-search') as HTMLInputElement).focus(), 50);
};
(window as any).closeAllModelsModal = function (): void { $('all-models-modal').classList.add('hidden'); };
function renderAllModels(): void {
  const q = (($('all-models-search') as HTMLInputElement).value || '').toLowerCase().trim();
  const filtered = q
    ? allModelsCache.filter(r => r.model.toLowerCase().includes(q) || r.serverName.toLowerCase().includes(q))
    : allModelsCache;
  if (allModelsCache.length === 0) {
    $('all-models-list').innerHTML = `<div class="model-dropdown-empty">No models returned. Check that your servers are reachable.</div>`;
    return;
  }
  if (!filtered.length) {
    $('all-models-list').innerHTML = `<div class="model-dropdown-empty">No models match "${esc(q)}"</div>`;
    return;
  }
  const byServer = new Map<number, { serverName: string; baseUrl: string; models: string[] }>();
  for (const r of filtered) {
    if (!byServer.has(r.serverIdx)) byServer.set(r.serverIdx, { serverName: r.serverName, baseUrl: r.baseUrl, models: [] });
    byServer.get(r.serverIdx)!.models.push(r.model);
  }
  let html = '';
  for (const [idx, group] of byServer) {
    html += `<div style="padding:10px 12px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);display:flex;align-items:center;gap:6px;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      ${esc(group.serverName)}
      <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted-2);">· ${esc(group.baseUrl.replace(/^https?:\/\//, ''))}</span>
    </div>`;
    for (const m of group.models) {
      const isCurrent = activeServer === idx && servers[idx]?.model === m;
      html += `<div class="model-dropdown-item ${isCurrent ? 'selected' : ''}" onclick="selectFromAllModels(${idx}, '${esc(m).replace(/'/g, "\\'")}')" style="padding-left: 24px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m)}</div>
          <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);">${esc(group.serverName)} : ${esc(m)}</div>
        </div>
        ${isCurrent ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--primary);"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
      </div>`;
    }
  }
  $('all-models-list').innerHTML = html;
}
(window as any).filterAllModels = function (_q: string): void { renderAllModels(); };
(window as any).selectFromAllModels = function (serverIdx: number, model: string): void {
  activeServer = serverIdx;
  servers[serverIdx].model = model;
  saveServers();
  saveSelectedModel(serverIdx, model);
  (window as any).setActive(serverIdx);
  (window as any).closeAllModelsModal();
  (window as any).closeModelDropdown();
};

// === CONVERSATIONS ===
function parseHashConvId(): string | null {
  const m = location.hash.match(/^#c=([\w-]+)$/);
  return m ? m[1] : null;
}
function syncUrlHash(): void {
  if (!currentId) return;
  const want = `#c=${currentId}`;
  if (location.hash !== want) {
    history.replaceState(null, '', want);
  }
}
window.addEventListener('hashchange', () => {
  const id = parseHashConvId();
  if (id && id !== currentId && conversations.find(c => c.id === id)) {
    saveCurrentConv();
    currentId = id;
    persistConversations();
    loadCurrentConv();
    renderMessages(); renderRecents(); updateTokenCount();
  }
});

function loadConversations(): void {
  try { conversations = JSON.parse(localStorage.getItem(CONV_KEY) || '[]'); } catch { conversations = []; }
  const hashId = parseHashConvId();
  const savedId = localStorage.getItem(CURRENT_CONV_KEY);
  let chosen: string | null = null;
  if (hashId && conversations.find(c => c.id === hashId)) chosen = hashId;
  else if (savedId && conversations.find(c => c.id === savedId)) chosen = savedId;
  else if (conversations.length > 0) chosen = conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  else chosen = createConversation();
  currentId = chosen;
  syncUrlHash();
  loadCurrentConv();
}
function createConversation(): string {
  const conv: Conversation = { id: uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  conversations.unshift(conv); persistConversations(); return conv.id;
}
function persistConversations(): void {
  localStorage.setItem(CONV_KEY, JSON.stringify(conversations));
  if (currentId) localStorage.setItem(CURRENT_CONV_KEY, currentId);
}
function loadCurrentConv(): void {
  const conv = conversations.find(c => c.id === currentId);
  messages = conv ? [...conv.messages] : [];
}
function saveCurrentConv(touch: boolean = false): void {
  const conv = conversations.find(c => c.id === currentId);
  if (!conv) return;
  conv.messages = messages;
  const firstUser = conv.messages.find(m => m.role === 'user');
  if (firstUser) conv.title = firstUser.content.length > 35 ? firstUser.content.slice(0, 35) + '…' : firstUser.content;
  if (touch) {
    conv.updatedAt = Date.now();
    conversations = [conv, ...conversations.filter(c => c.id !== currentId)];
  }
  persistConversations();
}
(window as any).newChat = function (): void {
  saveCurrentConv();
  currentId = createConversation();
  syncUrlHash();
  loadCurrentConv();
  renderMessages(); renderRecents(); updateTokenCount(); inputEl.focus();
};
(window as any).switchConv = function (id: string): void {
  if (id === currentId) return;
  saveCurrentConv();
  currentId = id;
  persistConversations();
  syncUrlHash();
  loadCurrentConv();
  renderMessages(); renderRecents(); updateTokenCount();
};
(window as any).deleteConv = function (id: string): void {
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  if (!confirm(`Delete "${conv.title}"?`)) return;
  conversations = conversations.filter(c => c.id !== id);
  if (currentId === id) {
    if (conversations.length > 0) currentId = conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    else currentId = createConversation();
    persistConversations();
    syncUrlHash();
    loadCurrentConv();
    renderMessages();
  } else persistConversations();
  renderRecents();
};
(window as any).filterRecents = function (q: string): void {
  const query = q.toLowerCase();
  document.querySelectorAll('.recents-item').forEach((el) => {
    (el as HTMLElement).style.display = (el.getAttribute('data-title') || '').toLowerCase().includes(query) ? '' : 'none';
  });
};
function renderRecents(): void {
  const realConvs = conversations.filter(c => c.messages.length > 0 || c.id === currentId);
  const sorted = [...realConvs].sort((a, b) => b.updatedAt - a.updatedAt);
  if (sorted.length === 0) { recentsEl.innerHTML = ''; return; }
  recentsEl.innerHTML = sorted.map(c => `
    <div class="recents-item ${c.id === currentId ? 'active' : ''}" data-title="${esc(c.title)}">
      <button class="recents-btn" onclick="switchConv('${c.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>${esc(c.title)}</span>
      </button>
      <button class="recents-delete" onclick="event.stopPropagation();copyConvLink('${c.id}')" data-tooltip="Copy link">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </button>
      <button class="recents-delete" onclick="event.stopPropagation();deleteConv('${c.id}')" data-tooltip="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');
}
(window as any).copyConvLink = function (id: string): void {
  const url = `${location.origin}${location.pathname}#c=${id}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied');
  }).catch(() => {
    prompt('Copy this link:', url);
  });
};
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string): void {
  let t = $('toast') as HTMLDivElement | null;
  if (!t) {
    t = document.createElement('div') as HTMLDivElement;
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--card);color:var(--fg);border:1px solid var(--border);border-radius:10px;padding:8px 14px;font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);opacity:0;transition:opacity 150ms;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t!.style.opacity = '1');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.style.opacity = '0', 1800);
}

// === STREAMING (Vercel AI SDK) ===
async function streamChatVercel(
  server: Server,
  apiMessages: CoreMessage[],
  onText: (chunk: string) => void,
  onReasoning: (chunk: string) => void,
  onToolCall: (toolName: string, args: unknown) => void,
  onToolResult: (toolName: string, result: unknown) => void,
  onError: (err: Error) => void,
  signal: AbortSignal,
): Promise<void> {
  const handle = streamChat(server, apiMessages, { onText, onReasoning, onToolCall, onToolResult, onError }, signal);
  activeStreamAbort = handle.abort;
  await handle.promise;
  activeStreamAbort = null;
}

// === rAF-COALESCED STREAMING RENDER ===
let userScrolledState = false;
function userScrolledUp(): boolean { return userScrolledState; }
(window as any).onMessagesScroll = function (): void {
  const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  userScrolledState = !atBottom && messages.length > 0;
  autoscrollBtn.classList.toggle('visible', userScrolledState);
};
(window as any).scrollToBottom = function (): void {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  userScrolledState = false;
  autoscrollBtn.classList.remove('visible');
};

function scheduleStreamRender(msg: AssistantMessage, container: HTMLElement): void {
  if (streamRafId !== null) return;
  streamRafId = requestAnimationFrame(() => {
    streamRafId = null;
    if (!container.isConnected) return;
    container.innerHTML = renderAssistantInner(msg);
    enhanceCodeBlocks(container);
    if (userScrolledUp()) {
      // don't auto-scroll
    } else {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });
}

// === RENDERING ===
function renderMessages(): void {
  if (messages.length === 0) {
    messagesEl.innerHTML = `<div id="welcome" class="welcome-container">
      <div style="display:flex;align-items:center;gap:15px;margin-bottom:8px;">
        <div style="font-size:44px;transform:translateY(-2px);">🦥</div>
        <h1 class="welcome-title">How can I help you today?</h1>
      </div>
      <div class="suggested-prompts">
        <button class="suggested-prompt" onclick="usePrompt(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/></svg>Search the latest news</button>
        <button class="suggested-prompt" onclick="usePrompt(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>Write a Python function</button>
        <button class="suggested-prompt" onclick="usePrompt(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>Explain a concept</button>
        <button class="suggested-prompt" onclick="usePrompt(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>Summarize a document</button>
      </div></div>`;
    return;
  }
  let html = '';
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user') html += renderUserMessage(m, i);
    else if (m.role === 'assistant') html += renderAssistantMessage(m, i);
    else if (m.role === 'tool' && m.tool === 'web_search') html += renderSearchTool(m, i);
    else if (m.role === 'tool') html += renderGenericTool(m, i);
  }
  messagesEl.innerHTML = html;
  enhanceCodeBlocks(messagesEl);
  if (!userScrolledUp()) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderUserMessage(m: Message, i: number): string {
  if (m.role !== 'user') return '';
  const atts = m.attachments || [];
  const attsHtml = atts.length > 0 ? `<div class="msg-attachments">${atts.map(a => {
    const thumb = a.kind === 'image' ? `<img src="${esc(a.data)}" alt="">` : `<span style="font-size:14px;">${fileIcon(a)}</span>`;
    return `<div class="msg-att-chip">${thumb}<span>${esc(a.name)}</span></div>`;
  }).join('')}</div>` : '';
  if (editingMsgIdx === i) {
    return `<div class="message-row user-row animate-fade-in" style="margin-bottom:16px;gap:8px;">
      <textarea class="user-edit-input" id="edit-input-${i}" onkeydown="handleEditKey(event, ${i})">${esc(m.content)}</textarea>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" style="height:28px;font-size:12px;" onclick="cancelEdit()">Cancel</button>
        <button class="btn btn-primary" style="height:28px;font-size:12px;" onclick="saveEdit(${i})">Save & Submit</button>
      </div>
    </div>`;
  }
  return `<div class="message-row user-row animate-fade-in" style="margin-bottom:16px;" data-msg-idx="${i}">
    ${attsHtml}
    <div class="user-bubble editable" onclick="startEdit(${i})" title="Click to edit">${esc(m.content)}</div>
    <div class="msg-actions" style="margin-top:4px;">
      <button class="msg-action-btn" onclick="event.stopPropagation();startEdit(${i})" data-tooltip="Edit">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="msg-action-btn" onclick="event.stopPropagation();deleteMessage(${i})" data-tooltip="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  </div>`;
}

function renderAssistantMessage(m: Message, i: number): string {
  if (m.role !== 'assistant') return '';
  const isEmpty = !m.content;
  const timing = m.timing ? `<span class="msg-timing">${esc(m.timing)}</span>` : '';
  const reasoningBlock = m.reasoning ? renderReasoningBlock(m.reasoning) : '';
  return `<div class="message-row assistant-row" style="margin-bottom:16px;" data-msg-idx="${i}">
    ${reasoningBlock}
    <div class="assistant-content">${renderAssistantInner(m)}</div>
    ${!isEmpty ? `<div class="msg-actions">
      <button class="msg-action-btn" onclick="copyMessage(${i})" data-tooltip="Copy">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="msg-action-btn" onclick="regenerateMessage(${i})" data-tooltip="Regenerate">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
      </button>
      <button class="msg-action-btn" onclick="deleteMessage(${i})" data-tooltip="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
      ${timing}
    </div>` : ''}
  </div>`;
}

function renderAssistantInner(m: AssistantMessage): string {
  if (!m.content && m.status === 'running') {
    return `<div class="status-text"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span> Generating...</div>`;
  }
  if (!m.content && m.status === 'cancelled') return '<em style="color:var(--muted);">Cancelled</em>';
  if (!m.content) return '';
  return marked.parse(m.content) as string;
}

function renderReasoningBlock(reasoning: string): string {
  return `<div class="reasoning-block collapsed" style="margin-bottom:8px;">
    <div class="reasoning-header" onclick="this.parentElement.classList.toggle('collapsed')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>
      <span>Thought for a moment</span>
      <svg class="reasoning-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </div>
    <div class="reasoning-body">${esc(reasoning)}</div>
  </div>`;
}

function renderSearchTool(m: Message, i: number): string {
  if (m.role !== 'tool' || m.tool !== 'web_search') return '';
  const sm = m as SearchToolMessage;
  const isRunning = sm.status === 'running';
  const statusBadge = isRunning
    ? `<span class="tool-call-status"><div class="spinner" style="width:10px;height:10px;border-width:1.5px;"></div> Searching</span>`
    : `<span class="tool-call-status complete"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg> ${sm.results.length} results</span>`;

  let sourcesHtml = '';
  if (sm.results && sm.results.length > 0) {
    const visible = sm.showAll ? sm.results : sm.results.slice(0, 6);
    const badges = visible.map(r => {
      const domain = getDomain(r.url);
      return `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="source-badge" title="${esc(r.title)} — ${esc(r.snippet.slice(0, 100))}">
        <img class="source-favicon" src="https://www.google.com/s2/favicons?domain=${esc(domain)}&sz=32" onerror="this.outerHTML='<div class=&quot;source-favicon&quot;>${(domain[0]||'W').toUpperCase()}</div>'">
        <span>${esc(r.title.length > 30 ? r.title.slice(0, 30) + '…' : r.title)}</span>
      </a>`;
    }).join('');
    const moreBtn = sm.results.length > 6
      ? `<button class="show-more-btn" onclick="toggleSources(${i})">${sm.showAll ? 'Show less' : `+${sm.results.length - 6} more`}</button>`
      : '';
    sourcesHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;">${badges}${moreBtn}</div>`;
  } else if (sm.status === 'complete') {
    sourcesHtml = '<div style="margin-top:8px;font-size:13px;color:var(--muted);">No results found. Try rephrasing your query.</div>';
  }

  return `<div class="message-row" style="margin-bottom:8px;">
    <div class="tool-call-box" data-tool-idx="${i}">
      <div class="tool-call-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span style="font-size:14px;color:var(--fg);">Web search</span>
        <span style="color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">"${esc(sm.query.length > 30 ? sm.query.slice(0, 30) + '…' : sm.query)}"</span>
        ${statusBadge}
        <svg class="tool-call-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="tool-call-body">${sourcesHtml}</div>
    </div>
  </div>`;
}

function renderGenericTool(m: Message, i: number): string {
  if (m.role !== 'tool' || m.tool === 'web_search') return '';
  const gt = m as GenericToolMessage;
  const isRunning = gt.status === 'running';
  const statusBadge = isRunning
    ? `<span class="tool-call-status"><div class="spinner" style="width:10px;height:10px;border-width:1.5px;"></div> Searching</span>`
    : `<span class="tool-call-status complete"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg> Done</span>`;

  let body = '';
  if (gt.status === 'complete' && gt.result) {
    body = `<div class="tool-call-body"><div style="font-size:13px;line-height:1.6;color:var(--muted-2);max-height:300px;overflow-y:auto;white-space:pre-wrap;">${esc(gt.result.slice(0, 2000))}${gt.result.length > 2000 ? '…' : ''}</div></div>`;
  } else if (gt.status === 'complete') {
    body = '<div class="tool-call-body"><div style="font-size:13px;color:var(--muted);">No documentation found.</div></div>';
  }

  return `<div class="message-row" style="margin-bottom:8px;">
    <div class="tool-call-box" data-tool-idx="${i}">
      <div class="tool-call-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <span style="font-size:14px;color:var(--fg);">${esc(gt.label)}</span>
        <span style="color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">"${esc(gt.input.length > 30 ? gt.input.slice(0, 30) + '…' : gt.input)}"</span>
        ${statusBadge}
        <svg class="tool-call-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      ${body}
    </div>
  </div>`;
}

(window as any).toggleSources = function (i: number): void {
  const m = messages[i];
  if (m && m.role === 'tool') { m.showAll = !m.showAll; renderMessages(); }
};

let enhancedSet = new WeakSet<HTMLElement>();
function enhanceCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll('pre').forEach((pre) => {
    if (enhancedSet.has(pre)) return;
    enhancedSet.add(pre);
    const code = pre.querySelector('code');
    if (!code) return;
    const langMatch = (code.className || '').match(/language-(\w+)/);
    const lang = langMatch ? langMatch[1] : '';
    try {
      if (lang && hljs.getLanguage(lang)) code.innerHTML = hljs.highlight(code.textContent || '', { language: lang, ignoreIllegals: true }).value;
      else code.innerHTML = hljs.highlightAuto(code.textContent || '').value;
      code.classList.add('hljs');
    } catch {}
    if (!pre.querySelector('.code-header')) {
      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `<span>${esc(lang || 'text')}</span><button class="code-copy" onclick="copyCode(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>`;
      pre.insertBefore(header, code);
    }
  });
}

(window as any).copyCode = function (btn: HTMLButtonElement): void {
  const pre = btn.closest('pre');
  const code = pre?.querySelector('code');
  if (!code) return;
  navigator.clipboard.writeText(code.textContent || '').then(() => {
    btn.classList.add('copied');
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Copied';
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = '<svg width="12" width="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy'; }, 2000);
  });
};

(window as any).copyMessage = function (i: number): void {
  const m = messages[i]; if (!m) return;
  const content = m.role === 'assistant' ? m.content : '';
  navigator.clipboard.writeText(content || '');
};
(window as any).regenerateMessage = async function (i: number): Promise<void> {
  let userIdx = i - 1;
  while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--;
  if (userIdx < 0) return;
  messages = messages.slice(0, i);
  await resendFromIdx(userIdx);
};
(window as any).deleteMessage = function (i: number): void {
  messages = messages.slice(0, i); saveCurrentConv(true); renderMessages(); renderRecents(); updateTokenCount();
};

(window as any).startEdit = function (i: number): void {
  editingMsgIdx = i; renderMessages();
  setTimeout(() => { const inp = $('edit-input-' + i) as HTMLTextAreaElement | null; if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 50);
};
(window as any).cancelEdit = function (): void { editingMsgIdx = -1; renderMessages(); };
(window as any).handleEditKey = function (e: KeyboardEvent, i: number): void {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (window as any).saveEdit(i); }
  if (e.key === 'Escape') (window as any).cancelEdit();
};
(window as any).saveEdit = async function (i: number): Promise<void> {
  const inp = $('edit-input-' + i) as HTMLTextAreaElement | null;
  if (!inp) return;
  const newText = inp.value.trim(); if (!newText) return;
  const m = messages[i];
  if (m && m.role === 'user') m.content = newText;
  editingMsgIdx = -1;
  messages = messages.slice(0, i + 1);
  saveCurrentConv(true); renderMessages(); renderRecents();
  await resendFromIdx(i);
};

function updateTokenCount(): void {
  const total = messages.reduce((sum, m) => {
    if (m.role === 'assistant') {
      return sum + estimateTokens(m.content) + estimateTokens(m.reasoning);
    }
    if (m.role === 'user') {
      return sum + estimateTokens(m.content);
    }
    return sum;
  }, 0);
  tokenText.textContent = total < 1000 ? total.toString() : (total / 1000).toFixed(1) + 'k';
  tokenFill.style.width = Math.min(100, (total / 8000) * 100) + '%';
}

(window as any).usePrompt = function (btn: HTMLElement): void {
  inputEl.value = btn.textContent?.trim() || '';
  inputEl.focus();
  inputEl.dispatchEvent(new Event('input'));
};

(window as any).exportConv = function (): void {
  const conv = conversations.find(c => c.id === currentId);
  if (!conv || conv.messages.length === 0) { alert('No messages to export.'); return; }
  let md = `# ${conv.title}\n\n`;
  for (const m of conv.messages) {
    if (m.role === 'user') md += `## User\n\n${m.content}\n\n`;
    else if (m.role === 'assistant') md += `## Assistant\n\n${m.content}\n\n`;
  }
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = conv.title.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.md';
  a.click();
};

(window as any).togglePill = function (name: string): void {
  if (name === 'search') { searchOn = !searchOn; ($('search-pill') as HTMLButtonElement).dataset.active = String(searchOn); }
  if (name === 'code') { codeOn = !codeOn; ($('code-pill') as HTMLButtonElement).dataset.active = String(codeOn); }
  if (name === 'thinking') { thinkingOn = !thinkingOn; ($('thinking-pill') as HTMLButtonElement).dataset.active = String(thinkingOn); }
  try { localStorage.setItem(PILLS_KEY, JSON.stringify({ searchOn, codeOn, thinkingOn })); } catch {}
};

function loadPills(): void {
  try {
    const p = JSON.parse(localStorage.getItem(PILLS_KEY) || 'null');
    if (p) {
      searchOn = !!p.searchOn;
      codeOn = !!p.codeOn;
      thinkingOn = !!p.thinkingOn;
    }
  } catch {}
  ($('search-pill') as HTMLButtonElement).dataset.active = String(searchOn);
  ($('code-pill') as HTMLButtonElement).dataset.active = String(codeOn);
  ($('thinking-pill') as HTMLButtonElement).dataset.active = String(thinkingOn);
}

function setGenerating(on: boolean): void {
  generating = on;
  sendBtn.disabled = on ? false : !inputEl.value.trim();
  if (on) {
    sendBtn.classList.add('stop');
    (sendIcon as unknown as SVGElement).innerHTML = '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="white"/>';
    sendBtn.dataset.tooltip = 'Stop';
  } else {
    sendBtn.classList.remove('stop');
    (sendIcon as unknown as SVGElement).innerHTML = '<path d="M12 19V5M5 12l7-7 7 7" stroke="white" stroke-width="2.5" fill="none"/>';
    sendBtn.dataset.tooltip = 'Send (Enter)';
    if (streamRafId !== null) { cancelAnimationFrame(streamRafId); streamRafId = null; }
    activeStreamAbort = null;
  }
}

(window as any).sendMessage = async function (): Promise<void> {
  if (generating) { if (activeStreamAbort) activeStreamAbort(); return; }
  const text = inputEl.value.trim();
  if (!text && pendingAttachments.length === 0) return;
  if (activeServer < 0) { alert('Please configure an AI server first.'); (window as any).openModal(); return; }
  inputEl.value = ''; inputEl.style.height = 'auto';
  setGenerating(true);
  startTime = Date.now(); streamChunks = 0;
  const attachments = pendingAttachments.length > 0 ? pendingAttachments : undefined;
  pendingAttachments = [];
  renderAttachments();
  updateSendEnabled();
  messages.push({ role: 'user', content: text, attachments });
  saveCurrentConv(true);
  renderMessages(); renderRecents(); updateTokenCount();
  await resendFromIdx(messages.length - 1);
};

async function resendFromIdx(userIdx: number): Promise<void> {
  const userMsg = messages[userIdx];
  if (!userMsg || userMsg.role !== 'user') return;
  const text = userMsg.content;
  setGenerating(true);
  startTime = Date.now(); streamChunks = 0;

  const apiMessages: CoreMessage[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'assistant') {
        return { role: 'assistant' as const, content: m.content };
      }
      const um = m as { role: 'user'; content: string; attachments?: Attachment[] };
      const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];
      const blocks: string[] = [];
      for (const a of um.attachments || []) {
        if (a.kind === 'pdf-md' || a.kind === 'text') {
          blocks.push(a.data);
        } else if (a.kind === 'image') {
          parts.push({ type: 'image', image: a.data });
        } else {
          blocks.push(`[Attachment: ${a.name} — ${formatSize(a.size)} — binary, cannot read]`);
        }
      }
      const textPrefix = blocks.length > 0 ? blocks.join('\n\n') + '\n\n' : '';
      parts.unshift({ type: 'text', text: textPrefix + um.content });
      return { role: 'user' as const, content: parts };
    });

  const assistantMsg: AssistantMessage = { role: 'assistant', content: '', reasoning: '', status: 'running' };
  messages.push(assistantMsg);
  renderMessages();

  const updateAssistant = (): void => {
    const lastRow = messagesEl.querySelector(`[data-msg-idx="${messages.length - 1}"]`) as HTMLElement | null;
    if (!lastRow) return;
    const contentEl = lastRow.querySelector('.assistant-content') as HTMLElement | null;
    if (!contentEl) return;
    scheduleStreamRender(assistantMsg, contentEl);
  };

  const server = servers[activeServer];
  if (!server) {
    assistantMsg.content = '**Error:** No server configured. Open settings to add one.';
    assistantMsg.status = 'complete';
    renderMessages();
    setGenerating(false);
    return;
  }

  const controller = new AbortController();
  const errorContent: string | null = null;

  try {
    await streamChatVercel(
      server,
      apiMessages,
      (chunk) => { assistantMsg.content += chunk; streamChunks++; updateAssistant(); },
      (reasoning) => { assistantMsg.reasoning = (assistantMsg.reasoning || '') + reasoning; updateAssistant(); },
      (toolName, args) => {
        if (toolName === 'webSearch') {
          const argsObj = args as { query?: string } | undefined;
          const query = argsObj?.query || text;
          const toolMsg: SearchToolMessage = { role: 'tool', tool: 'web_search', query, status: 'running', results: [] };
          messages.splice(messages.length - 1, 0, toolMsg);
          pendingToolMessageIdx = messages.indexOf(toolMsg);
          renderMessages();
        } else {
          const label = toolName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
          const a = args as Record<string, unknown> | undefined;
          const inp = a ? JSON.stringify(a).slice(0, 200) : '';
          const toolMsg: GenericToolMessage = { role: 'tool', tool: toolName, label, input: inp, status: 'running', result: '' };
          messages.splice(messages.length - 1, 0, toolMsg);
          pendingToolMessageIdx = messages.indexOf(toolMsg);
          renderMessages();
        }
      },
      (toolName, result) => {
        if (toolName === 'webSearch' && pendingToolMessageIdx >= 0) {
          const m = messages[pendingToolMessageIdx];
          if (m && m.role === 'tool' && m.tool === 'web_search') {
            const r = result as { results?: SearchResult[] } | undefined;
            (m as SearchToolMessage).results = r?.results || [];
            m.status = 'complete';
            renderMessages();
          }
        } else if (pendingToolMessageIdx >= 0) {
          const m = messages[pendingToolMessageIdx];
          if (m && m.role === 'tool' && m.tool === toolName) {
            const r = result as { content?: string } | undefined;
            (m as GenericToolMessage).result = r?.content || (typeof result === 'string' ? result : JSON.stringify(result, null, 2));
            m.status = 'complete';
            renderMessages();
          }
        }
      },
      (err) => {
        if (err.name !== 'AbortError') {
          assistantMsg.content = `**Error:** ${err.message}\n\nCheck your server configuration.`;
          renderMessages();
        } else {
          assistantMsg.status = 'cancelled';
        }
      },
      controller.signal,
    );
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      if (!errorContent) {
        assistantMsg.content = `**Error:** ${e?.message || String(e)}\n\nCheck your server configuration.`;
        renderMessages();
      }
    } else {
      assistantMsg.status = 'cancelled';
    }
  }
  if (!assistantMsg.content && assistantMsg.status !== 'cancelled') assistantMsg.content = '*No response received.*';
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  assistantMsg.timing = `${streamChunks} tok · ${elapsed}s`;
  assistantMsg.status = 'complete';
  pendingToolMessageIdx = -1;
  saveCurrentConv(true); renderRecents();
  if (streamRafId !== null) { cancelAnimationFrame(streamRafId); streamRafId = null; }
  const lastRow = messagesEl.querySelector(`[data-msg-idx="${messages.length - 1}"]`) as HTMLElement | null;
  if (lastRow) {
    lastRow.innerHTML = renderAssistantMessage(assistantMsg, messages.length - 1);
    enhanceCodeBlocks(lastRow);
  }
  updateTokenCount();
  setGenerating(false);
}

// === EVENTS ===
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  updateSendEnabled();
});
inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (window as any).sendMessage(); } });
sendBtn.addEventListener('click', () => { (window as any).sendMessage(); });

// === ATTACHMENTS ===
let pendingAttachments: Attachment[] = [];

function updateSendEnabled(): void {
  if (!generating) sendBtn.disabled = !inputEl.value.trim() && pendingAttachments.length === 0;
}

function renderAttachments(): void {
  if (pendingAttachments.length === 0) {
    attachmentsStrip.innerHTML = '';
    attachmentsStrip.classList.add('hidden');
    return;
  }
  attachmentsStrip.classList.remove('hidden');
  attachmentsStrip.innerHTML = pendingAttachments.map((a, i) => {
    const thumb = a.kind === 'image'
      ? `<img src="${esc(a.data)}" alt="">`
      : `<span>${fileIcon(a)}</span>`;
    return `
      <div class="att-chip" data-att-idx="${i}">
        <div class="att-chip-thumb">${thumb}</div>
        <div class="att-chip-info">
          <div class="att-chip-name">${esc(a.name)}</div>
          <div class="att-chip-meta">${attachmentLabel(a)} · ${formatSize(a.size)}</div>
        </div>
        <div class="att-chip-remove" onclick="removeAttachment(${i})" data-tooltip="Remove">×</div>
      </div>
    `;
  }).join('');
}

(window as any).removeAttachment = function (i: number): void {
  pendingAttachments.splice(i, 1);
  renderAttachments();
  updateSendEnabled();
};

async function addFiles(files: FileList | File[]): Promise<void> {
  const arr = Array.from(files);
  for (const file of arr) {
    const placeholder: Attachment = { name: file.name, mime: file.type || 'application/octet-stream', kind: 'text', data: '', size: file.size };
    pendingAttachments.push(placeholder);
    renderAttachments();
    try {
      const att = await processFile(file);
      const idx = pendingAttachments.indexOf(placeholder);
      if (idx >= 0) pendingAttachments[idx] = att;
    } catch (e) {
      console.error('Failed to process', file.name, e);
      const idx = pendingAttachments.indexOf(placeholder);
      if (idx >= 0) {
        pendingAttachments[idx] = { ...placeholder, kind: 'file', data: `[Error reading file: ${e instanceof Error ? e.message : String(e)}]` };
      }
    }
    renderAttachments();
  }
  updateSendEnabled();
}

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) {
    addFiles(fileInput.files);
    fileInput.value = '';
  }
});
inputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length > 0) {
    e.preventDefault();
    addFiles(files);
  }
});
const composerSurface = document.querySelector('.composer-surface') as HTMLElement | null;
composerSurface?.addEventListener('dragover', (e) => { e.preventDefault(); });
composerSurface?.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
});

document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (!t.closest('#model-btn') && !t.closest('#model-dropdown')) modelDropdown.classList.add('hidden');
});
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key === 'O') { e.preventDefault(); (window as any).newChat(); }
  if (mod && e.key === '/') { e.preventDefault(); inputEl.focus(); }
  if (mod && e.key === 'k') { e.preventDefault(); ($('search-input') as HTMLInputElement).focus(); }
  if (mod && e.key === 'b') { e.preventDefault(); (window as any).toggleSidebar(); }
  if (e.key === 'Escape') {
    if (!$('model-picker-modal').classList.contains('hidden')) (window as any).closeModelPicker();
    else if (!$('settings-modal').classList.contains('hidden')) (window as any).closeModal();
    else if (generating && activeStreamAbort) activeStreamAbort();
  }
});

// === JS TOOLTIP ===
(function setupJsTooltip(): void {
  const tip = document.createElement('div');
  tip.id = 'js-tooltip';
  document.body.appendChild(tip);
  let activeEl: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('mouseover', e => {
    const el = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement | null;
    if (!el || el === activeEl) return;
    activeEl = el;
    if (hideTimer) clearTimeout(hideTimer);
    tip.textContent = el.dataset.tooltip || '';
    tip.classList.add('visible');
  });
  document.addEventListener('mousemove', e => {
    if (!activeEl) return;
    const rect = tip.getBoundingClientRect();
    let x = e.clientX;
    let y = e.clientY - 14;
    x = Math.max(rect.width / 2 + 4, Math.min(window.innerWidth - rect.width / 2 - 4, x));
    y = Math.max(rect.height + 4, y);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  const hide = (): void => {
    hideTimer = setTimeout(() => {
      activeEl = null;
      tip.classList.remove('visible');
    }, 30);
  };
  document.addEventListener('mouseout', e => {
    const el = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement | null;
    if (el && el === activeEl) hide();
  });
  document.addEventListener('scroll', hide, true);
})();

// === INIT ===
loadTheme();
loadSidebar();
loadServers();
loadPills();
loadConversations();
renderRecents();
renderMessages();
updateTokenCount();
inputEl.focus();
