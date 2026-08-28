import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverInstalledPlugins } from "../src/features/claude-code-plugin-loader"
import { buildPluginTree } from "./fixtures/plugin-tree"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("discoverInstalledPlugins (integration)", () => {
  it("discovers a plugin listed in installed_plugins.json and resolves its manifest", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { skills: ["greet"] },
    })
    cleanups.push(tree.cleanup)

    expect(tree.errors).toHaveLength(0)
    expect(tree.plugins).toHaveLength(1)

    const plugin = tree.plugins[0]!
    expect(plugin.name).toBe("demo")
    expect(plugin.version).toBe("1.2.3")
    expect(plugin.scope).toBe("user")
    expect(plugin.pluginKey).toBe("demo@test-marketplace")
    expect(plugin.installPath).toBe(tree.installPath)
    expect(plugin.manifest?.name).toBe("demo")
    expect(plugin.skillsDir).toBe(join(tree.installPath, "skills"))
  })

  it("strips the version suffix from the plugin key when deriving the name", () => {
    // installPath points at a versioned cache dir; the plugin name must come
    // from the manifest, not the versioned directory name.
    const tree = buildPluginTree({
      name: "versioned-plugin",
      version: "2.0.0",
    })
    cleanups.push(tree.cleanup)

    expect(tree.plugins).toHaveLength(1)
    expect(tree.plugins[0]!.name).toBe("versioned-plugin")
    expect(tree.plugins[0]!.version).toBe("2.0.0")
  })

  it("returns an empty result when installed_plugins.json is missing", () => {
    const pluginsHome = mkdtempSync(join(tmpdir(), "compat-empty-"))
    cleanups.push(() => rmSync(pluginsHome, { recursive: true, force: true }))

    const result = discoverInstalledPlugins({ pluginsHomeOverride: pluginsHome })
    expect(result.plugins).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it("skips a plugin whose manifest is malformed without crashing", () => {
    const pluginsHome = mkdtempSync(join(tmpdir(), "compat-malformed-"))
    cleanups.push(() => rmSync(pluginsHome, { recursive: true, force: true }))

    const installPath = join(pluginsHome, "cache", "m__broken", "1.0.0")
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true })
    writeFileSync(join(installPath, ".claude-plugin", "plugin.json"), "{ not json", "utf-8")
    writeFileSync(
      join(pluginsHome, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "broken@m": [
            {
              scope: "user",
              installPath,
              version: "1.0.0",
              installedAt: "2026-08-27T00:00:00Z",
              lastUpdated: "2026-08-27T00:00:00Z",
            },
          ],
        },
      }),
      "utf-8",
    )

    const result = discoverInstalledPlugins({ pluginsHomeOverride: pluginsHome })
    // Malformed manifest -> plugin still discovered (name derived from key),
    // but manifest is null. No crash.
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]!.manifest).toBeUndefined()
    expect(result.plugins[0]!.name).toBe("broken")
  })

  it("filters out project-scoped plugins whose projectPath does not match cwd", () => {
    const pluginsHome = mkdtempSync(join(tmpdir(), "compat-scope-"))
    cleanups.push(() => rmSync(pluginsHome, { recursive: true, force: true }))

    const projectDir = mkdtempSync(join(tmpdir(), "compat-project-"))
    cleanups.push(() => rmSync(projectDir, { recursive: true, force: true }))
    const otherDir = mkdtempSync(join(tmpdir(), "compat-other-"))
    cleanups.push(() => rmSync(otherDir, { recursive: true, force: true }))

    const installPath = join(pluginsHome, "cache", "m__proj", "1.0.0")
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true })
    writeFileSync(
      join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "proj", version: "1.0.0" }),
      "utf-8",
    )
    writeFileSync(
      join(pluginsHome, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "proj@m": [
            {
              scope: "project",
              projectPath: projectDir,
              installPath,
              version: "1.0.0",
              installedAt: "2026-08-27T00:00:00Z",
              lastUpdated: "2026-08-27T00:00:00Z",
            },
          ],
        },
      }),
      "utf-8",
    )

    const originalCwd = process.cwd()
    process.chdir(otherDir)
    try {
      const result = discoverInstalledPlugins({ pluginsHomeOverride: pluginsHome })
      expect(result.plugins).toHaveLength(0)
    } finally {
      process.chdir(originalCwd)
    }
  })
})
