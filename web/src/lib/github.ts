const GITHUB_API = 'https://api.github.com';

async function ghFetch(path: string): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'clean-chat' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export async function getRepoInfo(owner: string, repo: string): Promise<{ content: string }> {
  try {
    const [repoData, branches] = await Promise.all([
      ghFetch(`/repos/${enc(owner)}/${enc(repo)}`),
      ghFetch(`/repos/${enc(owner)}/${enc(repo)}/branches?per_page=20`),
    ]);
    const branchList = branches.map((b: any) => b.name).join(', ');
    const topics = repoData.topics?.join(', ') || 'none';
    const lines = [
      `# ${repoData.full_name}`,
      repoData.description || '',
      '',
      `**Stars:** ${repoData.stargazers_count}  **Language:** ${repoData.language || 'N/A'}  **Forks:** ${repoData.forks_count}`,
      `**Topics:** ${topics}`,
      `**URL:** ${repoData.html_url}`,
      `**Default branch:** ${repoData.default_branch}`,
      `**Branches (${branches.length}):** ${branchList}`,
    ];
    return { content: lines.join('\n') };
  } catch (e: any) {
    return { content: `Error fetching repo info: ${e.message}` };
  }
}

export async function listBranches(owner: string, repo: string): Promise<{ content: string }> {
  try {
    const branches = await ghFetch(`/repos/${enc(owner)}/${enc(repo)}/branches?per_page=30`);
    if (!branches.length) return { content: 'No branches found.' };
    const lines = branches.map((b: any) => `- \`${b.name}\` (${b.commit.sha.slice(0, 7)})`);
    return { content: `# Branches for ${owner}/${repo}\n\n${lines.join('\n')}` };
  } catch (e: any) {
    return { content: `Error listing branches: ${e.message}` };
  }
}

export async function listCommits(owner: string, repo: string, branch?: string, limit = 10): Promise<{ content: string }> {
  try {
    const params = new URLSearchParams({ per_page: String(Math.min(limit, 30)) });
    if (branch) params.set('sha', branch);
    const commits = await ghFetch(`/repos/${enc(owner)}/${enc(repo)}/commits?${params}`);
    if (!commits.length) return { content: 'No commits found.' };
    const lines = commits.map((c: any) => {
      const msg = c.commit.message.split('\n')[0];
      const date = c.commit.author?.date?.slice(0, 10) || 'unknown';
      return `- \`${c.sha.slice(0, 7)}\` ${msg} — ${c.commit.author?.name || 'unknown'} (${date})`;
    });
    return { content: `# Commits for ${owner}/${repo}${branch ? ` (${branch})` : ''}\n\n${lines.join('\n')}` };
  } catch (e: any) {
    return { content: `Error listing commits: ${e.message}` };
  }
}

export async function listPRs(owner: string, repo: string, state = 'open', limit = 10): Promise<{ content: string }> {
  try {
    const params = new URLSearchParams({ state, per_page: String(Math.min(limit, 30)), sort: 'updated', direction: 'desc' });
    const prs = await ghFetch(`/repos/${enc(owner)}/${enc(repo)}/pulls?${params}`);
    if (!prs.length) return { content: `No ${state} pull requests found.` };
    const lines = prs.map((p: any) => {
      const labels = p.labels?.map((l: any) => l.name).join(', ') || '';
      return `- [#${p.number}](${p.html_url}) **${p.title}** — @${p.user?.login}${labels ? ` [${labels}]` : ''}`;
    });
    return { content: `# Pull Requests for ${owner}/${repo} (${state})\n\n${lines.join('\n')}` };
  } catch (e: any) {
    return { content: `Error listing PRs: ${e.message}` };
  }
}

export async function listIssues(owner: string, repo: string, state = 'open', limit = 10): Promise<{ content: string }> {
  try {
    const params = new URLSearchParams({ state, per_page: String(Math.min(limit, 30)), sort: 'updated', direction: 'desc' });
    const issues = await ghFetch(`/repos/${enc(owner)}/${enc(repo)}/issues?${params}`);
    if (!issues.length) return { content: `No ${state} issues found.` };
    const lines = issues.map((i: any) => {
      const labels = i.labels?.map((l: any) => l.name).join(', ') || '';
      return `- [#${i.number}](${i.html_url}) **${i.title}** — @${i.user?.login}${labels ? ` [${labels}]` : ''}`;
    });
    return { content: `# Issues for ${owner}/${repo} (${state})\n\n${lines.join('\n')}` };
  } catch (e: any) {
    return { content: `Error listing issues: ${e.message}` };
  }
}

async function rawFetch(owner: string, repo: string, path: string, branch: string): Promise<string> {
  const encodedPath = path.split('/').map(enc).join('/');
  const url = `https://raw.githubusercontent.com/${enc(owner)}/${enc(repo)}/${enc(branch)}/${encodedPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.text();
}

export async function fetchFile(owner: string, repo: string, path: string, branch?: string): Promise<{ content: string }> {
  const branches = branch ? [branch] : ['main', 'master'];
  for (const b of branches) {
    try {
      const content = await rawFetch(owner, repo, path, b);
      return { content: `# File: ${path} (branch: ${b})\n\n\`\`\`\n${content}\n\`\`\`` };
    } catch {
      continue;
    }
  }
  return { content: `Error: Could not fetch \`${path}\` from ${owner}/${repo}. Tried branches: ${branches.join(', ')}.` };
}

export async function fetchFiles(owner: string, repo: string, paths: string[], branch?: string): Promise<{ content: string }> {
  const results = await Promise.allSettled(
    paths.map(p => fetchFile(owner, repo, p, branch).then(r => ({ path: p, content: r.content })))
  );
  const parts: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      parts.push(r.value.content);
    } else {
      parts.push(`# Error fetching file\n\n${r.reason}`);
    }
  }
  return { content: parts.join('\n\n---\n\n') };
}

export async function getCommit(owner: string, repo: string, ref: string): Promise<{ content: string }> {
  try {
    const data = await ghFetch(`/repos/${enc(owner)}/${enc(repo)}/commits/${enc(ref)}`);
    const msg = data.commit.message;
    const author = data.commit.author?.name || 'unknown';
    const date = data.commit.author?.date?.slice(0, 10) || 'unknown';
    const stats = data.stats || {};
    const files = data.files || [];
    const lines = [
      `# Commit ${data.sha.slice(0, 7)} — ${msg.split('\n')[0]}`,
      '',
      `**Author:** ${author}  **Date:** ${date}`,
      `**Files changed:** ${files.length}  **++${stats.additions}**  **--${stats.deletions}**  **±${stats.total}**`,
      `**URL:** ${data.html_url}`,
      '',
    ];
    let fileIdx = 0;
    for (const f of files) {
      fileIdx++;
      lines.push(`### ${f.filename} (${f.status}) +${f.additions} -${f.deletions}`);
      if (f.patch) {
        const patchLines = f.patch.split('\n');
        const maxPatch = 80;
        const display = patchLines.length > maxPatch
          ? patchLines.slice(0, maxPatch).join('\n') + `\n... (${patchLines.length - maxPatch} more lines)`
          : f.patch;
        lines.push('```diff\n' + display + '\n```');
      }
      lines.push('');
    }
    if (files.length > 15) {
      lines.push(`*Showing all ${files.length} files with diffs truncated to 80 lines each.*`);
    }
    return { content: lines.join('\n') };
  } catch (e: any) {
    return { content: `Error fetching commit: ${e.message}` };
  }
}

export async function listFiles(owner: string, repo: string, path = ''): Promise<{ content: string }> {
  try {
    const apiPath = path ? `/repos/${enc(owner)}/${enc(repo)}/contents/${path.split('/').map(enc).join('/')}` : `/repos/${enc(owner)}/${enc(repo)}/contents`;
    const data = await ghFetch(apiPath);
    if (!Array.isArray(data)) {
      return { content: `# ${path || 'root'}\n\n\`${data.name}\` — file (${data.size} bytes)\n[view on GitHub](${data.html_url})` };
    }
    if (!data.length) return { content: `# ${path || 'root'}\n\n*(empty directory)*` };
    const dirs = data.filter((e: any) => e.type === 'dir').map((e: any) => `  📁 \`${e.name}/\``);
    const files = data.filter((e: any) => e.type === 'file').map((e: any) => `  📄 \`${e.name}\` (${formatSize(e.size)})`);
    const total = `\n*${data.filter((e: any) => e.type === 'dir').length} directories, ${data.filter((e: any) => e.type === 'file').length} files*`;
    return { content: `# ${path || 'root'} — ${owner}/${repo}\n\n${dirs.join('\n')}\n${files.join('\n')}${total}` };
  } catch (e: any) {
    if (e.message.includes('404')) {
      return { content: `Path not found: \`${path || 'root'}\` in ${owner}/${repo}. Check the path and try again.` };
    }
    return { content: `Error listing files: ${e.message}` };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
