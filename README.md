# opencode-claude-compat

Minimal OpenCode plugin that bridges Claude Code plugins/marketplaces (skills, commands, agents, hooks, MCPs) — extracted from [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)'s `claude-code-compat-core`.

## Install

```bash
opencode plugin add @jonathanmorley/opencode-claude-compat
```

Or add it to your OpenCode config directly:

```json
{
  "plugin": ["@jonathanmorley/opencode-claude-compat"]
}
```

## What it bridges

- **Skills** (`skills/**/SKILL.md` from installed plugins) → OpenCode skills
- **Slash commands** (`commands/*.md`) → OpenCode commands
- **Agents** (`agents/*.md`) → OpenCode subagents
- **Hooks** (PreToolUse/PostToolUse/etc.) → `tool.execute.before`/`tool.execute.after`
- **MCP servers** (`mcpServers` from plugin manifests + `.mcp.json`) → `mcp` config (env expansion, allowed-env filter)

Discovery reads `~/.claude/plugins/installed_plugins.json` plus the plugin cache under `~/.claude/plugins/cache` (override with `CLAUDE_PLUGINS_HOME`).

## What it does NOT do

- No team-mode, ultrawork, 50+ lifecycle hooks, or 11 agents — those stay in oh-my-openagent.
- Unknown plugin features (`outputStyles`, `lspServers`) are skipped.

## Sunset

This is a stopgap. Retire it once OpenCode's native unified marketplace (issue [#28696](https://github.com/sst/opencode/issues/28696) / PR [#40108](https://github.com/sst/opencode/pull/40108)) ships with a Claude catalog adapter.

## Development

```bash
bun install
bun test          # 226 tests
bun run build
npx tsc --noEmit
```

CI runs `bun test` + `build` + `typecheck` on every push/PR (`.github/workflows/ci.yml`); publish runs on version tags.

## Attribution

Extracted from [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — see `LICENSE.upstream.md` (Sustainable Use License 1.0).

## Releasing

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io). The pipeline:

1. **`release.yml`** runs on every push to `main`. It runs the test suite and a build as a gate, then mints a short-lived, tightly-scoped **GitHub App token** via [Octo STS](https://github.com/octo-sts/action) (trust policy in `.github/chainguard/release.sts.yaml`) and runs `semantic-release`.
2. `semantic-release` derives the next version from [conventional commits](https://www.conventionalcommits.org) since the last `v*` tag, updates the version in `package.json`, appends release notes to `CHANGELOG.md`, commits both, and pushes a `v<major>.<minor>.<patch>` tag. It also creates a GitHub Release.
3. Pushing the `v*` tag triggers the existing **`publish.yml`**, which runs tests/build again and publishes the package to npm with provenance (`npm publish --access public --provenance` via OIDC).

There is nothing to do by hand for a normal release — just merge conventional commits to `main`.

### Commit conventions

- `feat(...)` → minor bump (feature)
- `fix(...)` → patch bump (bugfix)
- `BREAKING CHANGE:` footer (or `!`) → major bump
- `chore`, `docs`, `test`, `refactor`, `ci`, `style`, `build`, `perf` → no release

If no release-worthy commit has landed since the last tag, `semantic-release` skips the release and no tag is created.

### One-time setup (already done for this repo)

Octo STS federates the Actions OIDC token into a **GitHub App** installation token. This requires:

- A GitHub App installed on the repository with `contents: write`, `issues: write`, and `pull_requests: write` permissions, registered with the Octo STS service (`octo-sts.dev` by default).
- The trust policy at `.github/chainguard/release.sts.yaml` in this repo, granting those permissions to the `release` identity for pushes on `main`.

### Notes / caveats

- `semantic-release` v25 requires Node `>= 24.10.0`; the `release` workflow therefore runs it with the Node runtime set up by `actions/setup-node` (the local `bun` runtime reports an older embedded Node and is not used for this step).
- The npm package version is bumped from `package.json` by `@semantic-release/npm` with `npmPublish: false`; actual publishing happens only in `publish.yml` via OIDC/provenance, so `semantic-release` needs no npm credentials.
- The GitHub App token must have write access to `main`. If branch protection is later added to `main`, the App must be added to the protected-branch allowlist so `semantic-release` can push release commits and tags.
