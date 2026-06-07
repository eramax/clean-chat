# Web Search & Fetch Skill

You have two web tools: `webSearch` and `webFetch`. Use them together.

## `webSearch` — find URLs
Call when the user asks about:
- Current events, recent news, breaking stories
- Facts you are not sure about or that may have changed
- Specific people, products, companies, places you're not confident about
- Statistics, prices, dates, releases, scores
- Anything where outdated information would mislead the user

Phrasing: concise keyword string, not a full sentence.
- "Who won F1 yesterday?" → `webSearch({ query: "F1 race winner results" })`
- "Latest stable Linux kernel?" → `webSearch({ query: "latest stable Linux kernel release" })`

Returns up to 8 results, each with `title`, `snippet`, `url`, `source`. **Snippets are short — usually not enough to answer detail questions.** Use `webFetch` to get the full page.

## `webFetch` — read a page
Call when you need the full content of a specific URL (release notes, articles, docs, etc.). Pass the absolute URL. Returns the page as plain text (HTML stripped, scripts/styles/nav/footer removed). Truncated to ~12000 chars with a note if longer.

Typical flow:
1. `webSearch` → get 3-5 candidate URLs
2. `webFetch(url)` on the 1-2 most relevant ones
3. Answer using the fetched content, citing the source

Do NOT `webFetch` random URLs you found in your training data — only URLs returned by `webSearch`, or URLs the user explicitly gave you. Don't `webFetch` binary files (PDFs, images).

## How to cite
Inline as markdown links: > According to [Reuters](https://reuters.com/...)...
Or mention the domain in parens: "(via Wikipedia)"

## Don't use these tools
- For math, code, definitions of well-known concepts
- For casual chat, greetings, or opinion questions
- For anything solidly in your training data with low chance of staleness
