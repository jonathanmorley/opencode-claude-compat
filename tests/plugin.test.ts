import { afterEach, describe, expect, it } from "bun:test"
import { join } from "node:path"
import type { V1PluginInput } from "../src/v1-types"
import plugin, { v1Plugin } from "../src/plugin"
import { v2Plugin } from "../src/v2"
import { loadClaudeHooksConfig, resetPluginHooksState } from "../src/features/claude-code-hooks/config"
import { clearPluginComponentsCache } from "../src/features/claude-code-plugin-loader"
import { buildPluginTree } from "./fixtures/plugin-tree"

const ctx = { client: {}, directory: "/tmp", worktree: "/tmp" } as unknown as V1PluginInput

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
    const hooks = await v1Plugin(ctx)
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
    const hooks = await v1Plugin({ ...ctx, directory: "/some/other/dir" })
    await hooks.config({})

    const config = await loadClaudeHooksConfig()
    expect(config?.PreToolUse?.[0]?.matcher).toBe("Bash")
  })
})

describe("plugin entry skill config", () => {
  it("adds discovered plugin skill directories to OpenCode skill paths", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { skills: ["greet"] },
    })
    cleanups.push(tree.cleanup)
    process.env.CLAUDE_PLUGINS_HOME = tree.pluginsHome
    process.env.CLAUDE_SETTINGS_PATH = join(tree.pluginsHome, "no-settings.json")
    process.env.CLAUDE_CONFIG_DIR = join(tree.pluginsHome, "no-config")

    const hooks = await v1Plugin(ctx)
    const pluginSkillsPath = join(tree.installPath, "skills")
    const config = { skills: { paths: ["/existing/skills"] } }

    await hooks.config(config)

    expect(config.skills.paths).toEqual([
      "/existing/skills",
      pluginSkillsPath,
    ])
  })
})

describe("dual plugin entry", () => {
  it("exposes V1 and V2 entries from the package default", () => {
    expect(plugin.id).toBe("opencode-claude-compat")
    expect(plugin.server).toBe(v1Plugin)
    expect(plugin.setup).toBe(v2Plugin.setup)
  })
})
