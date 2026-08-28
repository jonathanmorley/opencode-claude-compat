import { afterEach, describe, expect, it } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadPluginSkillsAsCommands } from "../src/features/claude-code-plugin-loader"
import { buildPluginTree } from "./fixtures/plugin-tree"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("loadPluginSkillsAsCommands (integration)", () => {
  it("loads skills/**/SKILL.md into namespaced skill commands", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { skills: ["greet"] },
    })
    cleanups.push(tree.cleanup)

    const skills = loadPluginSkillsAsCommands(tree.plugins)
    const key = "demo:greet"
    expect(skills[key]).toBeDefined()
    expect(skills[key]!.description).toContain("(plugin: demo - Skill)")
    expect(skills[key]!.template).toContain("Base directory for this skill")
    expect(skills[key]!.template).toContain("Do the thing.")
  })

  it("substitutes ${CLAUDE_PLUGIN_ROOT} in the skill body with the plugin install path", () => {
    const tree = buildPluginTree({
      name: "demo",
      components: { skills: ["refs"] },
    })
    cleanups.push(tree.cleanup)

    // Overwrite the SKILL.md with a body referencing ${CLAUDE_PLUGIN_ROOT}
    const skillMd = join(tree.installPath, "skills", "refs", "SKILL.md")
    writeFileSync(
      skillMd,
      "# refs\n\nRead ${CLAUDE_PLUGIN_ROOT}/data/notes.txt\n",
      "utf-8",
    )

    const skills = loadPluginSkillsAsCommands(tree.plugins)
    const template = skills["demo:refs"]!.template
    expect(template).toContain(`${tree.installPath}/data/notes.txt`)
    expect(template).not.toContain("${CLAUDE_PLUGIN_ROOT}")
  })

  it("returns an empty map when the plugin has no skills directory", () => {
    const tree = buildPluginTree({ name: "bare" })
    cleanups.push(tree.cleanup)

    const skills = loadPluginSkillsAsCommands(tree.plugins)
    expect(skills).toEqual({})
  })
})
