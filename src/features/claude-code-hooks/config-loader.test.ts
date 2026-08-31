import { describe, expect, it } from "bun:test"
import { isHookCommandDisabled } from "./config-loader"

describe("isHookCommandDisabled", () => {
  it("returns false when config is null", () => {
    expect(isHookCommandDisabled("PreToolUse", "echo hi", null)).toBe(false)
  })

  it("returns false when no patterns for event", () => {
    expect(isHookCommandDisabled("PreToolUse", "echo hi", { disabledHooks: {} })).toBe(false)
  })

  it("matches command with regex pattern", () => {
    const config = { disabledHooks: { PreToolUse: ["echo.*"] } }
    expect(isHookCommandDisabled("PreToolUse", "echo hello", config)).toBe(true)
    expect(isHookCommandDisabled("PreToolUse", "ls -la", config)).toBe(false)
  })

  it("falls back to literal match for invalid regex", () => {
    const config = { disabledHooks: { PreToolUse: ["[invalid"] } }
    // Invalid regex treated as literal string pattern
    expect(isHookCommandDisabled("PreToolUse", "[invalid", config)).toBe(true)
    expect(isHookCommandDisabled("PreToolUse", "something else", config)).toBe(false)
  })
})
