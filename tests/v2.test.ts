import { afterEach, describe, expect, it } from "bun:test"
import type { PluginContext } from "@opencode-ai/plugin/v2/promise"
import type {
  AgentV2Info,
  CommandV2Info,
  SkillV2Source,
} from "@opencode-ai/sdk/v2/types"
import { join } from "node:path"
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
} = {}) {
  const commands = new Map((options.commands ?? []).map((command) => [command.name, command]))
  const agents = new Map((options.agents ?? []).map((agent) => [agent.id, agent]))
  const sources: SkillV2Source[] = []

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

  const context = {
    command: { transform: commandTransform },
    agent: { transform: agentTransform },
    skill: { transform: skillTransform },
  } as unknown as PluginContext

  return { context, commands, agents, sources }
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
