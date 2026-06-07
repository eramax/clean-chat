interface Skill {
  name: string;
  content: string;
}

const skillModules = import.meta.glob('../skills/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const skills: Skill[] = Object.entries(skillModules).map(([path, content]) => ({
  name: path.split('/').pop()!.replace('.md', ''),
  content,
}));

const DEFAULT_SYSTEM_PROMPT = `You are Clean Chat, a helpful, friendly, and concise AI assistant. You use markdown formatting (headings, lists, code blocks, tables, blockquotes) to structure your answers.

You have access to a web search tool. Use it whenever the user asks a question that requires current information, recent events, facts you are not sure about, or anything that benefits from up-to-date data. Prefer calling the tool over guessing.

Be direct. Avoid filler phrases. When you use search results, cite the source inline as a markdown link.`;

export function buildSystemPrompt(): string {
  if (skills.length === 0) return DEFAULT_SYSTEM_PROMPT;
  const skillsBlock = skills
    .map((s) => `### Skill: ${s.name}\n\n${s.content.trim()}`)
    .join('\n\n---\n\n');
  return `${DEFAULT_SYSTEM_PROMPT}\n\n---\n\n# Bundled Skills\n\nThe following skills are available. Follow them when relevant.\n\n${skillsBlock}`;
}

export function listSkillNames(): string[] {
  return skills.map((s) => s.name);
}
