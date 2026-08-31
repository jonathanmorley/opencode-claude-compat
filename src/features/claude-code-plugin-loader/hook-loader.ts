import { existsSync, readFileSync } from "fs"
import { log } from "../../shared/logger"
import type { HookEntry, HooksConfig, LoadedPlugin } from "./types"
import { resolvePluginPaths } from "./plugin-path-resolver"

/**
 * Stamp every action with the plugin's installPath so that the downstream
 * dispatcher can set CLAUDE_PLUGIN_ROOT on the spawned hook process (#4458).
 * The plugin association is otherwise lost once configs are merged together.
 */
function stampPluginRoot(config: HooksConfig, pluginRoot: string): void {
  const eventMap = config.hooks
  if (!eventMap) return
  for (const matchers of Object.values(eventMap)) {
    if (!Array.isArray(matchers)) continue
    for (const matcher of matchers) {
      if (!Array.isArray(matcher?.hooks)) continue
      for (const action of matcher.hooks as HookEntry[]) {
        if (action && (action.type === "command" || action.type === "http")) {
          action.pluginRoot = pluginRoot
        }
      }
    }
  }
}

export function loadPluginHooksConfigs(plugins: LoadedPlugin[]): HooksConfig[] {
  const configs: HooksConfig[] = []

  for (const plugin of plugins) {
    const hooksPath = plugin.hooksPath
    const inlineHooks = plugin.manifest?.hooks

    if (hooksPath && existsSync(hooksPath)) {
      try {
        const config = resolvePluginPaths(
          JSON.parse(readFileSync(hooksPath, "utf-8")) as HooksConfig,
          plugin.installPath,
        )
        stampPluginRoot(config, plugin.installPath)

        configs.push(config)
        log(`Loaded plugin hooks config from ${plugin.name}`, { path: hooksPath })
      } catch (error) {
        log(`Failed to load plugin hooks config: ${hooksPath}`, error)
      }
    }

    if (inlineHooks && typeof inlineHooks !== "string") {
      try {
        const config = resolvePluginPaths({ hooks: inlineHooks }, plugin.installPath)
        stampPluginRoot(config, plugin.installPath)

        configs.push(config)
        log(`Loaded plugin hooks config from ${plugin.name}`, { path: "manifest" })
      } catch (error) {
        log("Failed to load plugin hooks config: manifest", error)
      }
    }
  }

  return configs
}
