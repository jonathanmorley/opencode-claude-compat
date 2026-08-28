import { afterEach, describe, expect, it } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadPluginCommands } from "../src/features/claude-code-plugin-loader"
import { buildPluginTree } from "./fixtures/plugin-tree"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("loadPluginCommands (integration)", () => {
  it("loads commands/*.md into namespaced command objects", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { commands: ["deploy"] },
    })
    cleanups.push(tree.cleanup)

    const commands = loadPluginCommands(tree.plugins)
    const key = "demo:deploy"
    expect(commands[key]).toBeDefined()
    expect(commands[key]!.description).toContain("(plugin: demo)")
    expect(commands[key]!.template).toContain("<command-instruction>")
    expect(commands[key]!.template).toContain("Run deploy for the user.")
  })

  it("substitutes ${CLAUDE_PLUGIN_ROOT} in the command body", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { commands: ["run"] },
    })
    cleanups.push(tree.cleanup)

    const commandMd = join(tree.installPath, "commands", "run.md")
    writeFileSync(
      commandMd,
      "---\nname: run\ndescription: Runs the script\n---\n\nExecute ${CLAUDE_PLUGIN_ROOT}/scripts/run.sh\n",
      "utf-8",
    )

    const commands = loadPluginCommands(tree.plugins)
    const template = commands["demo:run"]!.template
    expect(template).toContain(`${tree.installPath}/scripts/run.sh`)
    expect(template).not.toContain("${CLAUDE_PLUGIN_ROOT}")
  })

  it("returns an empty map when the plugin has no commands directory", () => {
    const tree = buildPluginTree({ name: "bare" })
    cleanups.push(tree.cleanup)

    const commands = loadPluginCommands(tree.plugins)
    expect(commands).toEqual({})
  })
})
