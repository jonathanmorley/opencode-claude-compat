## [0.2.1](https://github.com/jonathanmorley/opencode-claude-compat/compare/v0.2.0...v0.2.1) (2026-09-02)


### Bug Fixes

* **v2:** register optional MCP and tool hooks ([#16](https://github.com/jonathanmorley/opencode-claude-compat/issues/16)) ([a01a862](https://github.com/jonathanmorley/opencode-claude-compat/commit/a01a862198c393f89720f0a20607ff25bfefe188))

# [0.2.0](https://github.com/jonathanmorley/opencode-claude-compat/compare/v0.1.2...v0.2.0) (2026-09-01)


### Features

* add OpenCode V2 plugin support ([#15](https://github.com/jonathanmorley/opencode-claude-compat/issues/15)) ([cf1608f](https://github.com/jonathanmorley/opencode-claude-compat/commit/cf1608fe96544e32c27defb7cec4b2aa69fe5aeb))

## [0.1.2](https://github.com/jonathanmorley/opencode-claude-compat/compare/v0.1.1...v0.1.2) (2026-08-31)


### Bug Fixes

* **release:** publish to npm via semantic-release trusted publishing ([1897f7a](https://github.com/jonathanmorley/opencode-claude-compat/commit/1897f7a54a6d698f2ff34359f002161def5381c9))

## [0.1.1](https://github.com/jonathanmorley/opencode-claude-compat/compare/v0.1.0...v0.1.1) (2026-08-31)


### Bug Fixes

* load inline plugin hooks ([b37e394](https://github.com/jonathanmorley/opencode-claude-compat/commit/b37e39463aa949240cabc9b89d938bff7d4c5b53))
* preserve combined plugin hooks ([7e8c264](https://github.com/jonathanmorley/opencode-claude-compat/commit/7e8c26460e693268ce799087e969db6cb87bb739))
* **release:** correct Octo STS trust policy subject to include repo/owner IDs ([b110ca9](https://github.com/jonathanmorley/opencode-claude-compat/commit/b110ca92f1657c1f1f21bd003a5163f93d8b26e0))

# Changelog

## 0.1.0 — 2026-08-27

Initial release. Minimal OpenCode plugin bridging Claude Code plugins/marketplaces:

- Skills, slash commands, agents, hooks (PreToolUse/PostToolUse), and MCP servers from installed Claude Code plugins (`~/.claude/plugins/installed_plugins.json` + cache).
- Extracted from oh-my-openagent's `claude-code-compat-core` (upstream 4.19.4); compat-only, no harness (no team-mode, ultrawork, or 11 agents).
- Licensed under the upstream Sustainable Use License 1.0 (see `LICENSE.upstream.md`).

Stopgap: retire when OpenCode's native unified marketplace (issue #28696 / PR #40108) ships.
