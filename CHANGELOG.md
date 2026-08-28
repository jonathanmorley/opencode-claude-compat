# Changelog

## 0.1.0 — 2026-08-27

Initial release. Minimal OpenCode plugin bridging Claude Code plugins/marketplaces:

- Skills, slash commands, agents, hooks (PreToolUse/PostToolUse), and MCP servers from installed Claude Code plugins (`~/.claude/plugins/installed_plugins.json` + cache).
- Extracted from oh-my-openagent's `claude-code-compat-core` (upstream 4.19.4); compat-only, no harness (no team-mode, ultrawork, or 11 agents).
- Licensed under the upstream Sustainable Use License 1.0 (see `LICENSE.upstream.md`).

Stopgap: retire when OpenCode's native unified marketplace (issue #28696 / PR #40108) ships.