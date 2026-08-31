import { describe, expect, it } from "bun:test"
import { findMatchingHooks, matchesToolMatcher } from "./pattern-matcher"
import type { ClaudeHooksConfig } from "./types"

describe("matchesToolMatcher", () => {
  it("matches wildcard *", () => {
    expect(matchesToolMatcher("Bash", "*")).toBe(true)
  })

  it("matches exact tool case-insensitive", () => {
    expect(matchesToolMatcher("bash", "Bash")).toBe(true)
  })

  it("matches glob with *", () => {
    expect(matchesToolMatcher("mcp__fetch", "mcp__*")).toBe(true)
    expect(matchesToolMatcher("Bash", "mcp__*")).toBe(false)
  })

  it("matches pipe-separated alternatives", () => {
    expect(matchesToolMatcher("Bash", "Bash|Read")).toBe(true)
    expect(matchesToolMatcher("Read", "Bash|Read")).toBe(true)
    expect(matchesToolMatcher("Write", "Bash|Read")).toBe(false)
  })

  it("returns true for empty matcher", () => {
    expect(matchesToolMatcher("Bash", "")).toBe(true)
  })
})

describe("findMatchingHooks", () => {
  it("filters hooks by tool matcher", () => {
    const config: ClaudeHooksConfig = {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
        { matcher: "Read", hooks: [{ type: "command", command: "echo hi" }] },
      ],
    }
    expect(findMatchingHooks(config, "PreToolUse", "Bash")).toHaveLength(1)
    expect(findMatchingHooks(config, "PreToolUse", "Write")).toHaveLength(0)
  })

  it("returns all hooks when toolName is undefined", () => {
    const config: ClaudeHooksConfig = {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
    }
    expect(findMatchingHooks(config, "PreToolUse")).toHaveLength(1)
  })
})
