import type {
  AgentDraft,
  CommandDraft,
  Plugin as OpenCodeV2Plugin,
  PluginContext as OpenCodeV2PluginContext,
  SkillDraft,
} from "@opencode-ai/plugin/v2/promise"
import type {
  AgentV2Info,
  CommandV2Info,
  SkillV2Info,
  SkillV2Source,
} from "@opencode-ai/sdk/v2/types"
import { loadAllPluginComponents } from "./features/claude-code-plugin-loader"
import type { CommandDefinition } from "./features/claude-code-command-loader/types"
import type { ClaudeCodeAgentConfig } from "./features/claude-code-agent-loader/types"
import { log } from "./shared/logger"

export type V2PluginContext = OpenCodeV2PluginContext
export type V2Plugin = OpenCodeV2Plugin
export type V2CommandDraft = CommandDraft
export type V2AgentDraft = AgentDraft
export type V2SkillDraft = SkillDraft
export type V2Skill = SkillV2Info
export type V2SkillSource = SkillV2Source

export const setupV2 = async (ctx: V2PluginContext): Promise<void> => {
  console.log("[opencode-claude-compat] V2 plugin loaded")

  const components = await loadAllPluginComponents()

  await registerCommands(ctx, { ...components.commands, ...components.skills })
  await registerAgents(ctx, components.agents)
  await registerSkills(ctx, components.skillDefinitions ?? {})

  if (Object.keys(components.mcpServers).length > 0) {
    log("V2 plugin API has no MCP domain; skipping Claude Code MCP servers")
  }
  if (components.hooksConfigs.length > 0) {
    log("V2 plugin API has no tool hook domain; skipping Claude Code hooks")
  }
}

const pluginDefinition: V2Plugin = {
  id: "opencode-claude-compat",
  setup: setupV2,
}

// Keep this entrypoint free of runtime host imports so the package root remains
// loadable by both the V1 and V2 OpenCode plugin loaders.
export const v2Plugin = pluginDefinition

export default v2Plugin

async function registerCommands(
  ctx: V2PluginContext,
  definitions: Record<string, CommandDefinition>,
): Promise<void> {
  if (Object.keys(definitions).length === 0) return

  await ctx.command.transform((draft) => {
    for (const [name, definition] of Object.entries(definitions)) {
      if (!draft.get(name)) {
        log(`V2 CommandDraft cannot add Claude Code command: ${name}`)
        continue
      }

      draft.update(name, (command) => applyCommandDefinition(command, definition))
    }
  })
}

async function registerAgents(
  ctx: V2PluginContext,
  definitions: Record<string, ClaudeCodeAgentConfig>,
): Promise<void> {
  if (Object.keys(definitions).length === 0) return

  log("V2 AgentDraft uses update to apply Claude Code agent definitions")
  await ctx.agent.transform((draft) => {
    for (const [id, definition] of Object.entries(definitions)) {
      if (!draft.get(id)) {
        log(`V2 AgentDraft cannot add Claude Code agent: ${id}`)
        continue
      }

      draft.update(id, (agent) => applyAgentDefinition(agent, definition))
    }
  })
}

async function registerSkills(
  ctx: V2PluginContext,
  definitions: Record<string, { name: string; description: string; content: string; location: string }>,
): Promise<void> {
  if (Object.keys(definitions).length === 0) return

  await ctx.skill.transform((draft) => {
    for (const definition of Object.values(definitions)) {
      const skill: V2Skill = {
        name: definition.name,
        description: definition.description,
        location: definition.location,
        content: definition.content,
        slash: true,
      }

      draft.source({ type: "embedded", skill })
    }
  })
}

function applyCommandDefinition(command: CommandV2Info, definition: CommandDefinition): void {
  command.template = definition.template
  if (definition.description !== undefined) command.description = definition.description
  if (definition.agent !== undefined) command.agent = definition.agent
  if (definition.subtask !== undefined) command.subtask = definition.subtask

  const model = parseModelReference(definition.model)
  if (model !== undefined) command.model = model
}

function applyAgentDefinition(agent: AgentV2Info, definition: ClaudeCodeAgentConfig): void {
  if (definition.description !== undefined) agent.description = definition.description
  if (definition.mode !== undefined) agent.mode = definition.mode
  if (definition.prompt !== undefined) agent.system = definition.prompt

  const model = parseModelReference(definition.model)
  if (model !== undefined) agent.model = model
}

function parseModelReference(
  model: ClaudeCodeAgentConfig["model"],
): { id: string; providerID: string; variant?: string } | undefined {
  if (model && typeof model === "object") {
    return { id: model.modelID, providerID: model.providerID }
  }
  if (typeof model !== "string") return undefined

  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) return undefined

  const providerID = model.slice(0, separator)
  const modelReference = model.slice(separator + 1)
  const variantSeparator = modelReference.indexOf("#")
  const id = variantSeparator === -1 ? modelReference : modelReference.slice(0, variantSeparator)
  const variant = variantSeparator === -1 ? undefined : modelReference.slice(variantSeparator + 1)

  return {
    providerID,
    id,
    ...(variant ? { variant } : {}),
  }
}
