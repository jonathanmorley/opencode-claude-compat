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
    const hooksPath =
      plugin.hooksPath && existsSync(plugin.hooksPath) ? plugin.hooksPath : undefined
    const inlineHooks =
      plugin.manifest?.hooks && typeof plugin.manifest.hooks !== "string"
        ? { hooks: plugin.manifest.hooks }
        : undefined
    if (!hooksPath && !inlineHooks) continue
    const source = hooksPath ?? "manifest"

    try {
      let config: HooksConfig
      if (hooksPath) {
        config = JSON.parse(readFileSync(hooksPath, "utf-8")) as HooksConfig
      } else if (inlineHooks) {
        config = inlineHooks
      } else {
        continue
      }

      config = resolvePluginPaths(config, plugin.installPath)
      stampPluginRoot(config, plugin.installPath)

      configs.push(config)
      log(`Loaded plugin hooks config from ${plugin.name}`, { path: source })
    } catch (error) {
      log(`Failed to load plugin hooks config: ${source}`, error)
    }
  }

  return configs
}
