You have GitHub tools for browsing public repositories. Use these to explore project structure, check recent activity, and fetch source files.

## `browseRepo(owner, repo)`
Get repository metadata (description, stars, language, topics) and list branches. Use this first to understand a project.

## `listCommits(owner, repo, branch?, limit?)`
List recent commits with messages, authors, and dates. `branch` defaults to the default branch. `limit` max 30.

## `listBranches(owner, repo)`
List all branches in a repository.

## `listPRs(owner, repo, state?, limit?)`
List pull requests. `state` can be `"open"`, `"closed"`, or `"all"` (default `"open"`). `limit` max 30.

## `listIssues(owner, repo, state?, limit?)`
List issues with labels. `state` can be `"open"`, `"closed"`, or `"all"` (default `"open"`). `limit` max 30.

## `fetchFile(owner, repo, path, branch?)`
Fetch a single file's raw content. `branch` defaults to main (falls back to master). Use for reading source files, configs, READMEs.

## `fetchFiles(owner, repo, paths[], branch?)`
Fetch multiple files at once. Pass an array of file paths (e.g. `["src/index.ts", "package.json"]`). More efficient than calling fetchFile repeatedly.

## `getCommit(owner, repo, ref)`
Fetch a specific commit with full details: message, author, date, stats, and code diff (patch) per file. `ref` is the commit SHA (full or short hash). Use this after `listCommits` to see actual code changes.

## `listFiles(owner, repo, path?)`
Browse the repository file tree. Lists files and subdirectories in a given path (root by default). Use this to explore the repo layout, then call `fetchFile` to read specific files.
