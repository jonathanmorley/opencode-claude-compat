import { afterEach, describe, expect, it } from "bun:test"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import plugin from "../src/plugin"
import { loadClaudeHooksConfig, resetPluginHooksState } from "../src/features/claude-code-hooks/config"
import { clearPluginComponentsCache } from "../src/features/claude-code-plugin-loader"
import { buildPluginTree } from "./fixtures/plugin-tree"

const ctx = { client: {}, project: {}, directory: "/tmp", $: {} } as unknown as PluginInput

const cleanups: Array<() => void> = []

afterEach(() => {
  resetPluginHooksState()
  clearPluginComponentsCache()
  delete process.env.CLAUDE_PLUGINS_HOME
  delete process.env.CLAUDE_SETTINGS_PATH
  delete process.env.CLAUDE_CONFIG_DIR
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("plugin entry", () => {
  it("exports a function returning hooks including config and tool hooks", async () => {
    const hooks = await plugin(ctx)
    expect(hooks).toHaveProperty("config")
    // At minimum, config hook; tool hooks optional until hooks coverage lands
    expect(typeof hooks.config).toBe("function")
  })
})

describe("plugin entry hook config keying", () => {
  it("keys plugin hooks by process.cwd() so hooks fire when directory != cwd", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        hooks: {
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "echo '{}'" }] },
            ],
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    // Point discovery at the fixture tree and away from any real ~/.claude state.
    process.env.CLAUDE_PLUGINS_HOME = tree.pluginsHome
    process.env.CLAUDE_SETTINGS_PATH = join(tree.pluginsHome, "no-settings.json")
    process.env.CLAUDE_CONFIG_DIR = join(tree.pluginsHome, "no-config")

    // directory != process.cwd(): hooks must still be keyed by cwd to fire.
    const hooks = await plugin({ ...ctx, directory: "/some/other/dir" })
    await hooks.config({})

    const config = await loadClaudeHooksConfig()
    expect(config?.PreToolUse?.[0]?.matcher).toBe("Bash")
  })
})
