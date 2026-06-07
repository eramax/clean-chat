const PROXY = 'https://s.emolike.net/proxy.php';

interface Library {
  id: string;
  title: string;
  description: string;
  totalTokens?: number;
  totalSnippets?: number;
  stars?: number;
  trustScore?: number;
  versions?: string[];
}

async function proxyFetch(url: string): Promise<Response> {
  return fetch(`${PROXY}?url=${encodeURIComponent(url)}`, {
    headers: { 'Accept': 'application/json, text/plain, */*' },
  });
}

async function searchLibrary(libraryName: string, query: string): Promise<Library[]> {
  const url = `https://context7.com/api/v2/libs/search?libraryName=${encodeURIComponent(libraryName)}&query=${encodeURIComponent(query)}`;
  const res = await proxyFetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data?.results || [];
}

async function getContext(libraryId: string, query: string): Promise<string> {
  const url = `https://context7.com/api/v2/context?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(query)}&type=txt`;
  const res = await proxyFetch(url);
  if (!res.ok) return '';
  return res.text();
}

export async function context7Docs(libraryName: string, question: string): Promise<string> {
  const libs = await searchLibrary(libraryName, question);
  if (libs.length === 0) return `No library found matching "${libraryName}".`;

  const best = libs.sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0))[0];
  const ctx = await getContext(best.id, question);
  if (!ctx) return `Library "${best.title}" (${best.id}) found but no documentation context was returned. Try a more specific question.`;

  const header = `## ${best.title} — ${best.description}\nLibrary ID: \`${best.id}\`${best.stars ? ` · ⭐ ${best.stars.toLocaleString()}` : ''}${best.versions && best.versions.length > 0 ? ` · versions: ${best.versions.slice(0, 3).join(', ')}` : ''}\n\n`;
  return header + ctx;
}
