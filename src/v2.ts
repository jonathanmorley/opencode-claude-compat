import { dirname } from "node:path"
import type {
  AgentDraft,
  CommandDraft,
  Plugin as OpenCodeV2Plugin,
  PluginContext as OpenCodeV2PluginContext,
  SkillDraft,
} from "@opencode-ai/plugin/v2/promise"
import { setPluginHooksConfigs } from "./features/claude-code-hooks/config"
import { createToolExecuteAfterHandler } from "./features/claude-code-hooks/handlers/tool-execute-after-handler"
import type { ToolHandlerClient, ToolHandlerContext } from "./features/claude-code-hooks/handlers/context"
import { createToolExecuteBeforeHandler } from "./features/claude-code-hooks/handlers/tool-execute-before-handler"
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

type V2McpContext = {
  transform: (callback: (draft: { set: (name: string, config: unknown) => void }) => void) => Promise<unknown>
}

type V2ToolExecuteBeforeEvent = {
  tool: string
  sessionID: string
  id?: string
  callID?: string
  input: Record<string, unknown>
}

type V2ToolExecuteAfterEvent = {
  tool: string
  sessionID: string
  id?: string
  callID?: string
  status: "completed" | "error"
  result?: unknown
}

type V2ToolContext = {
  hook: (
    name: "execute.before" | "execute.after",
    callback: (event: V2ToolExecuteBeforeEvent | V2ToolExecuteAfterEvent) => Promise<void>,
  ) => Promise<unknown>
}

type V2CapabilityContext = V2PluginContext & {
  mcp?: V2McpContext
  tool?: V2ToolContext
  location?: { directory?: string }
  client?: ToolHandlerClient
  session?: { prompt?: (input: Record<string, unknown>) => Promise<unknown> }
}

/**
 * Editor shapes across V2 host generations. Newer hosts expose update-style
 * drafts (`get`/`update`, template-based commands, embedded skill sources);
 * stable hosts expose `add`-only editors (execute-based commands, skill
 * infos). Each registration below prefers the update-style API when present
 * and falls back to the stable API otherwise.
 */
interface StableCommandInvocation {
  sessionID: string
  prompt: { text?: string; [key: string]: unknown }
  delivery: "steer" | "queue"
}

interface StableCommandEditor {
  add: (definition: {
    name: string
    description?: string
    execute: (input: StableCommandInvocation) => Promise<void>
  }) => void
}

interface StableSkillEditor {
  add: (skill: {
    id: string
    name: string
    description?: string
    path: string
    content: string
  }) => void
}

function renderCommandTemplate(template: string, args: string): string {
  return template.replaceAll("$ARGUMENTS", args)
}

export const setupV2 = async (ctx: V2PluginContext): Promise<void> => {
  const components = await loadAllPluginComponents()

  await registerCommands(ctx, { ...components.commands, ...components.skills })
  await registerAgents(ctx, components.agents)
  await registerSkills(ctx, components.skillDefinitions ?? {})

  await registerMcpServers(ctx, components.mcpServers)
  await registerToolHooks(ctx, components.hooksConfigs)
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
    const updatable = draft as unknown as Partial<Pick<CommandDraft, "get" | "update">>
    if (typeof updatable.get === "function" && typeof updatable.update === "function") {
      for (const [name, definition] of Object.entries(definitions)) {
        if (!updatable.get(name)) {
          log(`V2 CommandDraft cannot add Claude Code command: ${name}`)
          continue
        }

        updatable.update(name, (command) => applyCommandDefinition(command, definition))
      }
      return
    }

    const stable = draft as unknown as Partial<StableCommandEditor>
    if (typeof stable.add !== "function") {
      log("V2 command editor supports neither update nor add; skipping Claude Code commands")
      return
    }

    const prompt = sessionPrompt(ctx)
    if (!prompt) {
      log("V2 host does not expose session.prompt; skipping Claude Code commands")
      return
    }

    for (const [name, definition] of Object.entries(definitions)) {
      const template = definition.template
      stable.add({
        name,
        ...(definition.description ? { description: definition.description } : {}),
        execute: async ({ sessionID, prompt: invocation, delivery }) => {
          await prompt({
            ...invocation,
            sessionID,
            text: renderCommandTemplate(template, invocation.text ?? ""),
            delivery,
          })
        },
      })
    }
  })
}

function sessionPrompt(
  ctx: V2PluginContext,
): ((input: Record<string, unknown>) => Promise<unknown>) | undefined {
  const prompt = (ctx as V2CapabilityContext).session?.prompt
  return typeof prompt === "function" ? prompt : undefined
}

async function registerAgents(
  ctx: V2PluginContext,
  definitions: Record<string, ClaudeCodeAgentConfig>,
): Promise<void> {
  if (Object.keys(definitions).length === 0) return

  log("V2 AgentDraft uses update to apply Claude Code agent definitions")
  await ctx.agent.transform((draft) => {
    const updatable = draft as unknown as Partial<Pick<AgentDraft, "get" | "update">>
    if (typeof updatable.get !== "function" || typeof updatable.update !== "function") {
      log(
        `V2 agent editor cannot add Claude Code agents; skipping ${Object.keys(definitions).length} agent definition(s)`,
      )
      return
    }

    for (const [id, definition] of Object.entries(definitions)) {
      if (!updatable.get(id)) {
        log(`V2 AgentDraft cannot add Claude Code agent: ${id}`)
        continue
      }

      updatable.update(id, (agent) => applyAgentDefinition(agent, definition))
    }
  })
}

async function registerMcpServers(
  ctx: V2PluginContext,
  servers: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(servers).length === 0) return

  const mcp = (ctx as V2CapabilityContext).mcp
  if (!mcp || typeof mcp.transform !== "function") {
    log("V2 plugin API has no MCP domain; skipping Claude Code MCP servers")
    return
  }

  await mcp.transform((draft) => {
    for (const [name, config] of Object.entries(servers)) {
      draft.set(name, config)
    }
  })
}

async function registerToolHooks(
  ctx: V2PluginContext,
  hooksConfigs: Parameters<typeof setPluginHooksConfigs>[1],
): Promise<void> {
  if (hooksConfigs.length === 0) return

  const tool = (ctx as V2CapabilityContext).tool
  if (!tool || typeof tool.hook !== "function") {
    log("V2 plugin API has no tool hook domain; skipping Claude Code hooks")
    return
  }

  setPluginHooksConfigs(process.cwd(), hooksConfigs)
  const handlerContext = createToolHandlerContext(ctx)
  // Mirror the keying for the instance directory so hooks fire when it
  // differs from process.cwd().
  if (handlerContext.directory !== process.cwd()) {
    setPluginHooksConfigs(handlerContext.directory, hooksConfigs)
  }
  const config = {}

  const before = createToolExecuteBeforeHandler(handlerContext, config)
  await tool.hook("execute.before", async (event) => {
    if (!("input" in event) || !isRecord(event.input)) return
    const callID = getToolCallID(event)
    if (!callID) return

    const output = { args: event.input }
    await before({ ...event, callID }, output)
    event.input = output.args
  })

  const after = createToolExecuteAfterHandler(handlerContext, config)
  await tool.hook("execute.after", async (event) => {
    if (!("result" in event) || event.status !== "completed") return
    const callID = getToolCallID(event)
    if (!callID || !isRecord(event.result)) return

    const result = event.result
    // Stable hosts report tool output as `content` (string or content parts);
    // newer hosts use the V1-shaped `{ title, output, metadata }`.
    const stableText = stableResultText(result)
    const output = {
      title: typeof result.title === "string" ? result.title : event.tool,
      output: typeof result.output === "string" ? result.output : (stableText ?? ""),
      metadata: result.metadata,
    }
    await after({ ...event, callID }, output)
    event.result =
      stableText === undefined
        ? { ...result, output: output.output, metadata: output.metadata }
        : withStableResultText(result, stableText, output.output)
  })
}

/**
 * Extract displayable text from a stable-host tool result, or `undefined`
 * when the result uses the newer `{ title, output, metadata }` shape.
 */
function stableResultText(result: Record<string, unknown>): string | undefined {
  if (typeof result.content === "string") return result.content
  if (Array.isArray(result.content)) {
    return result.content
      .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => (part as { text: string }).text)
      .join("\n\n")
  }
  return undefined
}

/**
 * Write hook-appended text back into a stable-host result, preserving the
 * original content shape (string stays a string; part lists keep their parts
 * and gain the appended text).
 */
function withStableResultText(
  result: Record<string, unknown>,
  original: string,
  updated: string,
): Record<string, unknown> {
  if (updated === original) return result
  if (typeof result.content === "string") return { ...result, content: updated }
  const delta = updated.startsWith(original) ? updated.slice(original.length).replace(/^\n+/, "") : updated
  return {
    ...result,
    content: [...(result.content as unknown[]), { type: "text", text: delta }],
  }
}

function getToolCallID(event: { id?: string; callID?: string }): string | undefined {
  return event.id ?? event.callID
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function createToolHandlerContext(ctx: V2PluginContext): ToolHandlerContext {
  const capabilityContext = ctx as V2CapabilityContext
  const directory = capabilityContext.location?.directory ?? process.cwd()

  return {
    directory,
    worktree: directory,
    client: capabilityContext.client,
  }
}

async function registerSkills(
  ctx: V2PluginContext,
  definitions: Record<string, { name: string; description: string; content: string; location: string }>,
): Promise<void> {
  if (Object.keys(definitions).length === 0) return

  await ctx.skill.transform((draft) => {
    const sourcing = draft as unknown as Partial<Pick<SkillDraft, "source">>
    if (typeof sourcing.source === "function") {
      for (const definition of Object.values(definitions)) {
        const skill: V2Skill = {
          name: definition.name,
          description: definition.description,
          location: definition.location,
          content: definition.content,
          slash: true,
        }

        sourcing.source({ type: "embedded", skill })
      }
      return
    }

    const stable = draft as unknown as Partial<StableSkillEditor>
    if (typeof stable.add !== "function") {
      log("V2 skill editor supports neither source nor add; skipping Claude Code skills")
      return
    }

    for (const definition of Object.values(definitions)) {
      stable.add({
        id: definition.name,
        name: definition.name,
        ...(definition.description ? { description: definition.description } : {}),
        path: dirname(definition.location),
        content: definition.content,
      })
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
