import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPluginHooksConfigs } from "../src/features/claude-code-plugin-loader"
import { executePreToolUseHooks } from "../src/features/claude-code-hooks/pre-tool-use"
import { executePostToolUseHooks } from "../src/features/claude-code-hooks/post-tool-use"
import type { ClaudeHooksConfig } from "../src/features/claude-code-hooks/types"
import { buildPluginTree } from "./fixtures/plugin-tree"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function makeCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "compat-hooks-cwd-"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// The plugin-loader HooksConfig.hooks and the hooks dispatcher's
// ClaudeHooksConfig are structurally identical but declared in separate type
// namespaces (matcher is optional in one, required in the other). Cast once
// here since the runtime shape is the same.
function hooksConfigOf(tree: ReturnType<typeof buildPluginTree>): ClaudeHooksConfig | null {
  const configs = loadPluginHooksConfigs(tree.plugins)
  return (configs[0]?.hooks ?? null) as ClaudeHooksConfig | null
}

describe("hooks dispatch (integration)", () => {
  it("loads a plugin hooks config and denies a PreToolUse when the hook blocks", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        hooks: {
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  { type: "command", command: `echo '{"decision":"deny","reason":"blocked"}'` },
                ],
              },
            ],
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    const config = hooksConfigOf(tree)
    expect(config).not.toBeNull()

    const result = await executePreToolUseHooks(
      { sessionId: "s1", toolName: "Bash", toolInput: { command: "ls" }, cwd: makeCwd() },
      config,
    )

    expect(result.decision).toBe("deny")
    expect(result.reason).toBe("blocked")
  })

  it("allows a PreToolUse when the hook approves", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        hooks: {
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: `echo '{"decision":"allow"}'` }],
              },
            ],
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    const config = hooksConfigOf(tree)
    const result = await executePreToolUseHooks(
      { sessionId: "s1", toolName: "Bash", toolInput: { command: "ls" }, cwd: makeCwd() },
      config,
    )

    expect(result.decision).toBe("allow")
  })

  it("blocks a PostToolUse when the hook returns decision block", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        hooks: {
          hooks: {
            PostToolUse: [
              {
                matcher: "Bash",
                hooks: [
                  { type: "command", command: `echo '{"decision":"block","reason":"nope"}'` },
                ],
              },
            ],
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    const config = hooksConfigOf(tree)
    const result = await executePostToolUseHooks(
      {
        sessionId: "s1",
        toolName: "Bash",
        toolInput: { command: "ls" },
        toolOutput: {},
        cwd: makeCwd(),
      },
      config,
    )

    expect(result.block).toBe(true)
    expect(result.reason).toBe("nope")
  })

  it("does not block a PostToolUse when the hook returns no decision", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        hooks: {
          hooks: {
            PostToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: `echo '{"decision":"allow"}'` }],
              },
            ],
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    const config = hooksConfigOf(tree)
    const result = await executePostToolUseHooks(
      {
        sessionId: "s1",
        toolName: "Bash",
        toolInput: { command: "ls" },
        toolOutput: {},
        cwd: makeCwd(),
      },
      config,
    )

    expect(result.block).toBe(false)
  })
})
