import { afterEach, describe, expect, it } from "bun:test"
import type { PluginContext } from "@opencode-ai/plugin/v2/promise"
import type {
  AgentV2Info,
  CommandV2Info,
  SkillV2Source,
} from "@opencode-ai/sdk/v2/types"
import { join, dirname } from "node:path"
import { clearPluginComponentsCache } from "../src/features/claude-code-plugin-loader"
import { resetPluginHooksState } from "../src/features/claude-code-hooks/config"
import { resolveSymlink } from "../src/shared/file-utils"
import { setupV2 } from "../src/v2"
import { buildPluginTree } from "./fixtures/plugin-tree"

const cleanups: Array<() => void> = []

afterEach(() => {
  resetPluginHooksState()
  clearPluginComponentsCache()
  delete process.env.CLAUDE_PLUGINS_HOME
  delete process.env.CLAUDE_SETTINGS_PATH
  delete process.env.CLAUDE_CONFIG_DIR
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function createContext(options: {
  commands?: CommandV2Info[]
  agents?: AgentV2Info[]
  mcp?: boolean
  tool?: boolean
} = {}) {
  const commands = new Map((options.commands ?? []).map((command) => [command.name, command]))
  const agents = new Map((options.agents ?? []).map((agent) => [agent.id, agent]))
  const sources: SkillV2Source[] = []
  const mcpServers = new Map<string, unknown>()
  const toolHooks = new Map<string, (event: unknown) => Promise<void>>()

  const commandTransform: PluginContext["command"]["transform"] = async (callback) => {
    callback({
      list: () => [...commands.values()],
      get: (name) => commands.get(name),
      update: (name, update) => {
        const command = commands.get(name)
        if (command) update(command)
      },
      remove: (name) => {
        commands.delete(name)
      },
    })
    return { dispose: async () => {} }
  }

  const agentTransform: PluginContext["agent"]["transform"] = async (callback) => {
    callback({
      list: () => [...agents.values()],
      get: (id) => agents.get(id),
      default: () => {},
      update: (id, update) => {
        const agent = agents.get(id)
        if (agent) update(agent)
      },
      remove: (id) => {
        agents.delete(id)
      },
    })
    return { dispose: async () => {} }
  }

  const skillTransform: PluginContext["skill"]["transform"] = async (callback) => {
    callback({
      source: (source) => sources.push(source),
      list: () => sources,
    })
    return { dispose: async () => {} }
  }

  const mcp = options.mcp
    ? {
        transform: async (callback: (draft: { set: (name: string, config: unknown) => void }) => void) => {
          callback({ set: (name, config) => mcpServers.set(name, config) })
        },
      }
    : undefined

  const tool = options.tool
    ? {
        hook: async (name: string, callback: (event: unknown) => Promise<void>) => {
          toolHooks.set(name, callback)
          return { dispose: async () => {} }
        },
      }
    : undefined

  const context = {
    command: { transform: commandTransform },
    agent: { transform: agentTransform },
    skill: { transform: skillTransform },
    ...(mcp ? { mcp } : {}),
    ...(tool ? { tool } : {}),
  } as unknown as PluginContext

  return { context, commands, agents, sources, mcpServers, toolHooks }
}

function configurePluginHome(tree: ReturnType<typeof buildPluginTree>): void {
  process.env.CLAUDE_PLUGINS_HOME = tree.pluginsHome
  process.env.CLAUDE_SETTINGS_PATH = join(tree.pluginsHome, "no-settings.json")
  process.env.CLAUDE_CONFIG_DIR = join(tree.pluginsHome, "no-config")
}

function existingCommand(name: string): CommandV2Info {
  return { name, template: "existing" }
}

function existingAgent(id: string): AgentV2Info {
  return {
    id,
    request: { headers: {}, body: {} },
    mode: "subagent",
    hidden: false,
    permissions: [],
  }
}

describe("V2 plugin setup", () => {
  it("does not print a startup message", async () => {
    const tree = buildPluginTree({ name: "demo" })
    cleanups.push(tree.cleanup)
    configurePluginHome(tree)
    const harness = createContext()
    const messages: unknown[][] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => messages.push(args)

    try {
      await setupV2(harness.context)
    } finally {
      console.log = originalLog
    }

    expect(messages).toEqual([])
  })

  it("registers MCP servers and tool hooks when the V2 context provides them", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        mcp: { mcpServers: { docs: { type: "stdio", command: "docs" } } },
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
    configurePluginHome(tree)
    const harness = createContext({ mcp: true, tool: true })

    await setupV2(harness.context)

    expect(harness.mcpServers.get("demo:docs")).toEqual({
      type: "local",
      command: ["docs"],
      enabled: true,
    })
    expect([...harness.toolHooks.keys()]).toEqual([
      "execute.before",
      "execute.after",
    ])

    const beforeEvent = {
      tool: "Bash",
      sessionID: "session",
      id: "call-1",
      input: {},
    }
    await harness.toolHooks.get("execute.before")!(beforeEvent)

    const afterEvent = {
      tool: "Bash",
      sessionID: "session",
      id: "call-1",
      status: "completed" as const,
      result: { metadata: { observed: true } },
    }
    await harness.toolHooks.get("execute.after")!(afterEvent)
    expect(afterEvent.result as Record<string, unknown>).toEqual({
      metadata: { observed: true },
      output: "",
    })
  })

  it("registers Claude skills as embedded V2 skill sources", async () => {
    const tree = buildPluginTree({ name: "demo", components: { skills: ["greet"] } })
    cleanups.push(tree.cleanup)
    configurePluginHome(tree)
    const harness = createContext()

    await setupV2(harness.context)

    expect(harness.sources).toHaveLength(1)
    expect(harness.sources[0]).toEqual({
      type: "embedded",
      skill: {
        name: "demo:greet",
        location: resolveSymlink(join(tree.installPath, "skills", "greet", "SKILL.md")),
        content: "# greet\n\nDo the thing.",
        slash: true,
        description: "(plugin: demo - Skill) ",
      },
    })
    expect(harness.sources[0]).not.toHaveProperty("skill.id")
  })

  it("skips MCP servers and hooks that the beta context cannot register", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        mcp: { mcpServers: { docs: { type: "stdio", command: "docs" } } },
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
    configurePluginHome(tree)
    const harness = createContext()

    await expect(setupV2(harness.context)).resolves.toBeUndefined()
    expect(harness.sources).toEqual([])
  })

  it("updates only existing beta commands, agents, and skills", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        commands: ["deploy"],
        skills: ["greet"],
        agents: ["reviewer"],
        mcp: { mcpServers: { docs: { type: "stdio", command: "docs" } } },
      },
    })
    cleanups.push(tree.cleanup)
    configurePluginHome(tree)
    const harness = createContext({
      commands: [existingCommand("demo:deploy"), existingCommand("demo:greet")],
      agents: [existingAgent("demo:reviewer")],
    })

    await setupV2(harness.context)

    expect([...harness.commands.keys()]).toEqual(["demo:deploy", "demo:greet"])
    expect(harness.commands.get("demo:deploy")).toMatchObject({
      template: expect.stringContaining("Run deploy for the user."),
      description: "(plugin: demo) Runs deploy",
    })
    expect(harness.commands.get("demo:greet")).toMatchObject({
      template: expect.stringContaining("Do the thing."),
    })

    expect(harness.agents.get("demo:reviewer")).toMatchObject({
      description: "(plugin: demo) Acts as reviewer",
      mode: "subagent",
      system: "You are reviewer.",
    })
    expect(harness.sources).toHaveLength(1)
    expect(harness.sources[0]).toMatchObject({
      type: "embedded",
      skill: { name: "demo:greet", slash: true },
    })
  })
})

describe("V2 plugin setup on stable hosts (add-only editors)", () => {
  interface StableCommand {
    name: string
    description?: string
    execute: (input: {
      sessionID: string
      prompt: { text?: string }
      delivery: "steer" | "queue"
    }) => Promise<void>
  }

  function createStableContext() {
    const commands: StableCommand[] = []
    const skills: Array<Record<string, unknown>> = []
    const mcpServers = new Map<string, unknown>()
    const toolHooks = new Map<string, (event: unknown) => Promise<void>>()
    const prompted: Array<Record<string, unknown>> = []
    let agentTransformCalls = 0

    const context = {
      location: { directory: process.cwd() },
      session: {
        prompt: async (input: Record<string, unknown>) => {
          prompted.push(input)
          return input
        },
      },
      command: {
        transform: async (callback: (editor: { add: (d: StableCommand) => void }) => void) => {
          callback({ add: (d) => commands.push(d) })
          return { dispose: async () => {} }
        },
      },
      agent: {
        transform: async (callback: (editor: Record<string, never>) => void) => {
          agentTransformCalls += 1
          callback({})
          return { dispose: async () => {} }
        },
      },
      skill: {
        transform: async (
          callback: (editor: { add: (s: Record<string, unknown>) => void }) => void,
        ) => {
          callback({ add: (s) => skills.push(s) })
          return { dispose: async () => {} }
        },
      },
      mcp: {
        transform: async (
          callback: (editor: { set: (name: string, config: unknown) => void }) => void,
        ) => {
          callback({ set: (name, config) => mcpServers.set(name, config) })
          return { dispose: async () => {} }
        },
      },
      tool: {
        hook: async (name: string, callback: (event: unknown) => Promise<void>) => {
          toolHooks.set(name, callback)
          return { dispose: async () => {} }
        },
      },
    } as unknown as PluginContext

    return {
      context,
      commands,
      skills,
      mcpServers,
      toolHooks,
      prompted,
      agentTransformCalls: () => agentTransformCalls,
    }
  }

  it("adds commands (including skill aliases), skills, and MCP servers; skips agents", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        skills: ["greet"],
        commands: ["deploy"],
        agents: ["reviewer"],
        mcp: { mcpServers: { docs: { type: "stdio", command: "docs" } } },
      },
    })
    cleanups.push(tree.cleanup)
    configurePluginHome(tree)
    const harness = createStableContext()

    await setupV2(harness.context)

    expect(harness.commands.map((c) => c.name).sort()).toEqual(["demo:deploy", "demo:greet"])
    expect(harness.skills).toHaveLength(1)
    expect(harness.skills[0]).toMatchObject({
      id: "demo:greet",
      name: "demo:greet",
      description: "(plugin: demo - Skill) ",
      path: dirname(resolveSymlink(join(tree.installPath, "skills", "greet", "SKILL.md"))),
      content: "# greet\n\nDo the thing.",
    })
    expect(harness.mcpServers.get("demo:docs")).toEqual({
      type: "local",
      command: ["docs"],
      enabled: true,
    })
    expect([...harness.toolHooks.keys()]).toEqual([])
    // The agent transform runs but the add-less editor cannot apply definitions.
    expect(harness.agentTransformCalls()).toBe(1)
  })

  it("command execute prompts with the template and substituted arguments", async () => {
    const tree = buildPluginTree({ name: "demo", components: { commands: ["deploy"] } })
    cleanups.push(tree.cleanup)
    configurePluginHome(tree)
    const harness = createStableContext()

    await setupV2(harness.context)

    const deploy = harness.commands.find((c) => c.name === "demo:deploy")!
    await deploy.execute({ sessionID: "s1", prompt: { text: "tonight" }, delivery: "steer" })

    expect(harness.prompted).toHaveLength(1)
    const sent = harness.prompted[0] as { sessionID: unknown; text: unknown }
    expect(sent.sessionID).toBe("s1")
    expect(typeof sent.text).toBe("string")
    const text = sent.text as string
    expect(text).toContain("Run deploy for the user.")
    expect(text).toContain("tonight")
    expect(text).not.toContain("$ARGUMENTS")
  })

  it("appends PostToolUse context to stable string and part-list results", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        hooks: {
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "echo '{}'" }] },
            ],
            PostToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    type: "command",
                    command: `echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"watch out"}}'`,
                  },
                ],
              },
            ],
          },
        },
      },
    })
    cleanups.push(tree.cleanup)
    configurePluginHome(tree)
    const harness = createStableContext()

    await setupV2(harness.context)

    const before = harness.toolHooks.get("execute.before")!
    const after = harness.toolHooks.get("execute.after")!
    await before({ tool: "Bash", sessionID: "s1", id: "c1", input: { command: "ls" } })

    const stringEvent = {
      tool: "Bash",
      sessionID: "s1",
      id: "c1",
      status: "completed" as const,
      result: { content: "done", metadata: {} },
    }
    await after(stringEvent)
    expect(stringEvent.result.content).toContain("done")
    expect(stringEvent.result.content).toContain("watch out")

    const partsEvent = {
      tool: "Bash",
      sessionID: "s1",
      id: "c1",
      status: "completed" as const,
      result: { content: [{ type: "text", text: "done" }], metadata: {} },
    }
    await after(partsEvent)
    const parts = partsEvent.result.content as Array<{ type: string; text?: string }>
    expect(parts[0]).toEqual({ type: "text", text: "done" })
    expect(parts[1]!.text).toContain("watch out")
  })

  it("ignores non-record tool input instead of corrupting it", async () => {
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
    configurePluginHome(tree)
    const harness = createStableContext()

    await setupV2(harness.context)

    const before = harness.toolHooks.get("execute.before")!
    const event = { tool: "Bash", sessionID: "s1", id: "c1", input: "ls" }
    await before(event)
    expect(event.input).toBe("ls")
  })
})
