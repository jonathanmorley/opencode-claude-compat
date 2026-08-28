/**
 * Shared integration-test fixtures for the Claude Code compat surface.
 *
 * Builds a real plugin tree in a tmpdir (installed_plugins.json + plugin
 * manifest + component dirs) and runs `discoverInstalledPlugins` against it,
 * so every loader test exercises discovery -> loader end-to-end rather than
 * hand-constructing `LoadedPlugin` objects.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverInstalledPlugins } from "../../src/features/claude-code-plugin-loader"
import type { LoadedPlugin } from "../../src/features/claude-code-plugin-loader/types"

export interface PluginTreeOptions {
  /** Plugin name used in the manifest and the plugin key. */
  name: string
  /** Marketplace name; forms the plugin key `name@marketplace`. */
  marketplace?: string
  /** Version recorded in installed_plugins.json. */
  version?: string
  /** Plugin scope. Defaults to "user" so cwd filtering never drops it. */
  scope?: "user" | "project" | "local" | "managed"
  /** Extra fields merged into the plugin manifest. */
  manifest?: Record<string, unknown>
  /** Component dirs to create. Each maps to a subdir under the install root. */
  components?: {
    skills?: string[]
    commands?: string[]
    agents?: string[]
    mcp?: unknown
    hooks?: unknown
  }
}

export interface PluginTree {
  /** The discovered plugin (length 1 when the fixture is well-formed). */
  plugins: LoadedPlugin[]
  /** Discovery errors (empty when the fixture is well-formed). */
  errors: { pluginKey: string; installPath: string; error: string }[]
  /** Absolute install path of the plugin. */
  installPath: string
  /** Absolute plugins-home dir (parent of installed_plugins.json). */
  pluginsHome: string
  /** Remove the tmpdir. */
  cleanup: () => void
}

/**
 * Build a plugin tree on disk and discover it. Returns the discovered plugins
 * plus a cleanup function. Callers must invoke cleanup in afterEach.
 */
export function buildPluginTree(options: PluginTreeOptions): PluginTree {
  const pluginsHome = mkdtempSync(join(tmpdir(), "compat-plugins-"))
  const marketplace = options.marketplace ?? "test-marketplace"
  const name = options.name
  const version = options.version ?? "1.2.3"
  const scope = options.scope ?? "user"

  // Versioned cache path: cache/marketplace__plugin/<version>
  const installPath = join(pluginsHome, "cache", `${marketplace}__${name}`, version)
  mkdirSync(installPath, { recursive: true })

  // Plugin manifest
  const manifestDir = join(installPath, ".claude-plugin")
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(
    join(manifestDir, "plugin.json"),
    JSON.stringify({ name, version, ...options.manifest }),
    "utf-8",
  )

  // Component dirs
  const components = options.components ?? {}
  for (const skill of components.skills ?? []) {
    const skillDir = join(installPath, "skills", skill)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}\n\nDo the thing.\n`, "utf-8")
  }
  for (const command of components.commands ?? []) {
    mkdirSync(join(installPath, "commands"), { recursive: true })
    writeFileSync(
      join(installPath, "commands", `${command}.md`),
      `---\nname: ${command}\ndescription: Runs ${command}\n---\n\nRun ${command} for the user.\n`,
      "utf-8",
    )
  }
  for (const agent of components.agents ?? []) {
    mkdirSync(join(installPath, "agents"), { recursive: true })
    writeFileSync(
      join(installPath, "agents", `${agent}.md`),
      `---\nname: ${agent}\ndescription: Acts as ${agent}\n---\n\nYou are ${agent}.\n`,
      "utf-8",
    )
  }
  if (components.mcp !== undefined) {
    writeFileSync(join(installPath, ".mcp.json"), JSON.stringify(components.mcp), "utf-8")
  }
  if (components.hooks !== undefined) {
    const hooksDir = join(installPath, "hooks")
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(join(hooksDir, "hooks.json"), JSON.stringify(components.hooks), "utf-8")
  }

  // installed_plugins.json (v2 format)
  writeFileSync(
    join(pluginsHome, "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        [`${name}@${marketplace}`]: [
          {
            scope,
            installPath,
            version,
            installedAt: "2026-08-27T00:00:00Z",
            lastUpdated: "2026-08-27T00:00:00Z",
          },
        ],
      },
    }),
    "utf-8",
  )

  const result = discoverInstalledPlugins({ pluginsHomeOverride: pluginsHome })

  return {
    plugins: result.plugins,
    errors: result.errors,
    installPath,
    pluginsHome,
    cleanup: () => rmSync(pluginsHome, { recursive: true, force: true }),
  }
}
