import { afterEach, describe, expect, it } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadPluginAgents } from "../src/features/claude-code-plugin-loader"
import { buildPluginTree } from "./fixtures/plugin-tree"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("loadPluginAgents (integration)", () => {
  it("loads agents/*.md into namespaced subagent configs", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { agents: ["reviewer"] },
    })
    cleanups.push(tree.cleanup)

    const agents = loadPluginAgents(tree.plugins)
    const key = "demo:reviewer"
    expect(agents[key]).toBeDefined()
    expect(agents[key]!.mode).toBe("subagent")
    expect(agents[key]!.description).toContain("(plugin: demo)")
    expect(agents[key]!.prompt).toContain("You are reviewer.")
  })

  it("maps a Claude model to an OpenCode model string", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { agents: ["coder"] },
    })
    cleanups.push(tree.cleanup)

    const agentMd = join(tree.installPath, "agents", "coder.md")
    writeFileSync(
      agentMd,
      "---\nname: coder\ndescription: Codes\nmodel: claude-sonnet-4-5\n---\n\nYou are coder.\n",
      "utf-8",
    )

    const agents = loadPluginAgents(tree.plugins, "anthropic")
    expect(agents["demo:coder"]!.model).toBeDefined()
  })

  it("substitutes ${CLAUDE_PLUGIN_ROOT} in the agent prompt", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { agents: ["helper"] },
    })
    cleanups.push(tree.cleanup)

    const agentMd = join(tree.installPath, "agents", "helper.md")
    writeFileSync(
      agentMd,
      "---\nname: helper\ndescription: Helps\n---\n\nRead ${CLAUDE_PLUGIN_ROOT}/docs/guide.md\n",
      "utf-8",
    )

    const agents = loadPluginAgents(tree.plugins)
    const prompt = agents["demo:helper"]!.prompt
    expect(prompt).toContain(`${tree.installPath}/docs/guide.md`)
    expect(prompt).not.toContain("${CLAUDE_PLUGIN_ROOT}")
  })

  it("returns an empty map when the plugin has no agents directory", () => {
    const tree = buildPluginTree({ name: "bare" })
    cleanups.push(tree.cleanup)

    const agents = loadPluginAgents(tree.plugins)
    expect(agents).toEqual({})
  })
})
