import { afterEach, describe, expect, it } from "bun:test"
import { cacheToolInput, clearToolInputCache, getToolInput, stopToolInputCacheCleanup } from "./tool-input-cache"

afterEach(() => {
  clearToolInputCache()
  stopToolInputCacheCleanup()
})

describe("tool-input-cache", () => {
  it("caches and retrieves tool input", () => {
    cacheToolInput("s1", "Bash", "c1", { command: "ls" })
    expect(getToolInput("s1", "Bash", "c1")).toEqual({ command: "ls" })
  })

  it("returns null on second get (one-shot)", () => {
    cacheToolInput("s1", "Bash", "c1", { command: "ls" })
    getToolInput("s1", "Bash", "c1")
    expect(getToolInput("s1", "Bash", "c1")).toBeNull()
  })

  it("clears entries by session", () => {
    cacheToolInput("s1", "Bash", "c1", { command: "a" })
    cacheToolInput("s2", "Bash", "c1", { command: "b" })
    clearToolInputCache("s1")
    expect(getToolInput("s1", "Bash", "c1")).toBeNull()
    expect(getToolInput("s2", "Bash", "c1")).toEqual({ command: "b" })
  })

  it("clears all entries when no session specified", () => {
    cacheToolInput("s1", "Bash", "c1", { command: "a" })
    cacheToolInput("s2", "Bash", "c1", { command: "b" })
    clearToolInputCache()
    expect(getToolInput("s1", "Bash", "c1")).toBeNull()
    expect(getToolInput("s2", "Bash", "c1")).toBeNull()
  })
})
