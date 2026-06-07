import type { SearchResult } from './types';

const PROXY = 'https://s.emolike.net/proxy.php';

const getDomain = (url: string): string => {
  try {
    return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', '');
  } catch {
    return url;
  }
};

const extractRealUrl = (href: string | null): string => {
  if (!href) return '';
  try {
    const m = href.match(/uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
  } catch {}
  return href;
};

export async function webSearch(query: string, timeoutMs = 8000): Promise<SearchResult[]> {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  const add = (r: SearchResult): void => {
    if (!r.url || seen.has(r.url)) return;
    seen.add(r.url);
    merged.push(r);
  };

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`webSearch timeout after ${timeoutMs}ms`)), timeoutMs),
  );

  const searchPromise = Promise.allSettled([
    (async () => {
      const res = await fetch(`${PROXY}?url=${encodeURIComponent(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)}`);
      if (!res.ok) return [];
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const out: SearchResult[] = [];
      doc.querySelectorAll('.result').forEach((el) => {
        const title = el.querySelector('.result__a');
        const snippet = el.querySelector('.result__snippet');
        const urlEl = el.querySelector('.result__url');
        if (!title || !snippet) return;
        const titleText = title.textContent?.trim() ?? '';
        const snippetText = snippet.textContent?.trim() ?? '';
        if (!titleText || !snippetText) return;
        const realUrl =
          extractRealUrl(urlEl?.getAttribute('href') ?? null) ||
          extractRealUrl(title.getAttribute('href') ?? null) ||
          '';
        if (!realUrl) return;
        out.push({ title: titleText, snippet: snippetText, url: realUrl, source: 'DuckDuckGo' });
      });
      return out;
    })(),
    (async () => {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=6&srprop=snippet&origin=*`,
      );
      if (!res.ok) return [];
      const data = await res.json();
      const hits = data?.query?.search || [];
      return hits
        .map((r: { title: string; snippet?: string }) => {
          const snippet = (r.snippet || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          return {
            title: r.title,
            snippet,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
            source: 'Wikipedia',
          };
        })
        .filter((r: SearchResult) => r.snippet);
    })(),
    (async () => {
      const res = await fetch(`${PROXY}?url=${encodeURIComponent(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`)}`);
      if (!res.ok) return [];
      const data = await res.json();
      const out: SearchResult[] = [];
      if (data.AbstractText && data.AbstractURL) {
        out.push({
          title: data.Heading || query,
          snippet: data.AbstractText,
          url: data.AbstractURL,
          source: data.AbstractSource || 'DuckDuckGo',
        });
      }
      if (Array.isArray(data.RelatedTopics)) {
        for (const t of data.RelatedTopics) {
          if (t.Topics) {
            for (const sub of t.Topics.slice(0, 3)) {
              if (sub.Text && sub.FirstURL) {
                out.push({
                  title: sub.Text.split(' - ')[0] || sub.Text.slice(0, 60),
                  snippet: sub.Text,
                  url: sub.FirstURL,
                  source: 'DuckDuckGo',
                });
              }
            }
          } else if (t.Text && t.FirstURL) {
            out.push({
              title: t.Text.split(' - ')[0] || t.Text.slice(0, 60),
              snippet: t.Text,
              url: t.FirstURL,
              source: 'DuckDuckGo',
            });
          }
          if (out.length >= 8) break;
        }
      }
      return out;
    })(),
  ]);

  const settled = await Promise.race([searchPromise, timeout]).catch((e) => {
    console.warn('webSearch:', (e as Error).message);
    return null;
  });
  if (!settled) return merged.slice(0, 8);

  const [ddgRes, wikiRes, instantRes] = settled;

  if (ddgRes.status === 'fulfilled' && Array.isArray(ddgRes.value)) ddgRes.value.forEach(add);
  if (wikiRes.status === 'fulfilled' && Array.isArray(wikiRes.value)) wikiRes.value.forEach(add);
  if (instantRes.status === 'fulfilled' && Array.isArray(instantRes.value)) instantRes.value.forEach((r) => {
    if (r.url && r.url.includes('en.wikipedia.org') && merged.find((m) => m.url === r.url)) return;
    add(r);
  });

  return merged.slice(0, 8);
}

export { getDomain };

export async function webFetch(url: string, maxLength = 12000): Promise<string> {
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  try {
    const res = await fetch(`https://r.jina.ai/${normalized}`, {
      headers: { 'X-Return-Format': 'markdown' },
    });
    if (!res.ok) return `(HTTP ${res.status})`;
    const md = await res.text();
    if (md.length <= maxLength) return md;
    return md.slice(0, maxLength) + `\n\n[...truncated, ${md.length - maxLength} more chars]`;
  } catch (e) {
    return `(fetch failed: ${e instanceof Error ? e.message : String(e)})`;
  }
}
