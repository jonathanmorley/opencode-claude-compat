# opencode-claude-compat

Minimal OpenCode plugin that bridges Claude Code plugins/marketplaces (skills, commands, agents, hooks, MCPs) — extracted from [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)'s `claude-code-compat-core`.

## Install

```bash
opencode plugin add opencode-claude-compat
```

Or add it to your OpenCode config directly:

```json
{
  "plugin": ["opencode-claude-compat"]
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

## Attribution

Extracted from [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — see `LICENSE.upstream.md` (Sustainable Use License 1.0).