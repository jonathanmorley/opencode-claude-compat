import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { resolveSymlink } from "../../shared/file-utils"
import { sanitizeModelField } from "../../shared/model-sanitizer"
import { resolveSkillPathReferences } from "../../shared/skill-path-resolver"
import { resolvePluginPath } from "./plugin-path-resolver"
import { log } from "../../shared/logger"
import type { CommandDefinition } from "../claude-code-command-loader/types"
import type { LoadedPlugin } from "./types"

interface SkillMetadata {
  name?: string
  description?: string
  model?: unknown
}

export interface LoadedPluginSkill {
  name: string
  description: string
  template: string
  content: string
  location: string
  model?: string
}

export function loadPluginSkills(plugins: LoadedPlugin[]): Record<string, LoadedPluginSkill> {
  const skills: Record<string, LoadedPluginSkill> = {}

  for (const plugin of plugins) {
    if (!plugin.skillsDir || !existsSync(plugin.skillsDir)) continue

    const entries = readdirSync(plugin.skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue

      const skillPath = join(plugin.skillsDir, entry.name)
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

      const resolvedPath = resolveSymlink(skillPath)
      const skillMdPath = join(resolvedPath, "SKILL.md")
      if (!existsSync(skillMdPath)) continue

      try {
        const content = readFileSync(skillMdPath, "utf-8")
        const { data, body } = parseFrontmatter<SkillMetadata>(content)

        const skillName = data.name || entry.name
        const namespacedName = `${plugin.name}:${skillName}`
        const originalDescription = data.description || ""
        const formattedDescription = `(plugin: ${plugin.name} - Skill) ${originalDescription}`

        const resolvedBody = resolveSkillPathReferences(body.trim(), resolvedPath)
        const pluginResolvedBody = resolvePluginPath(resolvedBody, plugin.installPath)
        const wrappedTemplate = `<skill-instruction>\nBase directory for this skill: ${resolvedPath}/\nFile references (@path) in this skill are relative to this directory.\n\n${pluginResolvedBody}\n</skill-instruction>\n\n<user-request>\n$ARGUMENTS\n</user-request>`

        const definition: LoadedPluginSkill = {
          name: namespacedName,
          description: formattedDescription,
          template: wrappedTemplate,
          content: pluginResolvedBody,
          location: resolveSymlink(skillMdPath),
          model: sanitizeModelField(data.model),
        }

        skills[namespacedName] = definition

        log(`Loaded plugin skill: ${namespacedName}`, { path: resolvedPath })
      } catch (error) {
        log(`Failed to load plugin skill: ${skillPath}`, error)
      }
    }
  }

  return skills
}

export function loadPluginSkillsAsCommands(
  plugins: LoadedPlugin[],
  loadedSkills: Record<string, LoadedPluginSkill> = loadPluginSkills(plugins),
): Record<string, CommandDefinition> {
  const commands: Record<string, CommandDefinition> = {}

  for (const [name, skill] of Object.entries(loadedSkills)) {
    const { name: _name, content: _content, location: _location, ...command } = skill
    commands[name] = command as CommandDefinition
  }

  return commands
}
