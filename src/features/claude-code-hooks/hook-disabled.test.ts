import { describe, expect, it } from "bun:test"
import { isHookDisabled } from "./hook-disabled"

describe("isHookDisabled", () => {
  it("returns false when disabledHooks is undefined", () => {
    expect(isHookDisabled({}, "PreToolUse")).toBe(false)
  })

  it("returns true when disabledHooks is true", () => {
    expect(isHookDisabled({ disabledHooks: true }, "PreToolUse")).toBe(true)
  })

  it("returns true when disabledHooks array includes hook type", () => {
    expect(isHookDisabled({ disabledHooks: ["PreToolUse", "PostToolUse"] }, "PreToolUse")).toBe(true)
  })

  it("returns false when disabledHooks array does not include hook type", () => {
    expect(isHookDisabled({ disabledHooks: ["PostToolUse"] }, "PreToolUse")).toBe(false)
  })
})
