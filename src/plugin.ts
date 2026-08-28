/**
 * Minimal OpenCode plugin shim — Claude Code compat only.
 *
 * Extracted from oh-my-openagent's omo-opencode plugin (upstream 4.19.4).
 * Wires Claude Code plugins/marketplaces (commands, skills, agents, MCPs,
 * hooks) into OpenCode via installed_plugins.json discovery.
 *
 * Upstream license: see LICENSE.upstream.md (SUL — this is a compat-only
 * extraction; Task 4 of the fork plan owns the license migration).
 */
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { loadAllPluginComponents } from "./features/claude-code-plugin-loader"
import { setPluginHooksConfigs } from "./features/claude-code-hooks/config"
import { createToolExecuteBeforeHandler } from "./features/claude-code-hooks/handlers/tool-execute-before-handler"
import { createToolExecuteAfterHandler } from "./features/claude-code-hooks/handlers/tool-execute-after-handler"
import type { PluginConfig } from "./features/claude-code-hooks/types"

export default (async (ctx: PluginInput) => {
  const config: PluginConfig = {}
  console.log("[opencode-claude-compat] plugin loaded")

  return {
    config: async (cfg) => {
      const c = cfg as Record<string, unknown>
      const components = await loadAllPluginComponents()

      c.command = {
        ...((c.command as Record<string, unknown>) ?? {}),
        ...components.commands,
        ...components.skills,
      }
      c.agent = {
        ...((c.agent as Record<string, unknown>) ?? {}),
        ...components.agents,
      }
      c.mcp = {
        ...((c.mcp as Record<string, unknown>) ?? {}),
        ...components.mcpServers,
      }

      // Key by process.cwd() to match the read side (loadClaudeHooksConfig /
      // discovery scope-filtering), not ctx.directory — opencode's config hook
      // runs with cwd = project root, and a mismatch would silently drop hooks.
      setPluginHooksConfigs(process.cwd(), components.hooksConfigs)
    },
    "tool.execute.before": createToolExecuteBeforeHandler(ctx, config),
    "tool.execute.after": createToolExecuteAfterHandler(ctx, config),
  }
}) satisfies Plugin
