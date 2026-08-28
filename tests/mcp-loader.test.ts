import { afterEach, describe, expect, it } from "bun:test"
import { loadPluginMcpServers } from "../src/features/claude-code-plugin-loader"
import { buildPluginTree } from "./fixtures/plugin-tree"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe("loadPluginMcpServers (integration)", () => {
  it("loads stdio mcpServers from .mcp.json into namespaced local servers", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        mcp: {
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
            },
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    const servers = await loadPluginMcpServers(tree.plugins)
    const key = "demo:filesystem"
    const server = servers[key]!
    expect(server.type).toBe("local")
    if (server.type === "local") {
      expect(server.command).toEqual([
        "npx",
        "-y",
        "@modelcontextprotocol/server-filesystem",
      ])
      expect(server.enabled).toBe(true)
    }
  })

  it("substitutes ${CLAUDE_PLUGIN_ROOT} in command and args", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        mcp: {
          mcpServers: {
            local: {
              command: "${CLAUDE_PLUGIN_ROOT}/bin/server",
              args: ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
            },
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    const servers = await loadPluginMcpServers(tree.plugins)
    const server = servers["demo:local"]!
    expect(server.type).toBe("local")
    if (server.type === "local") {
      expect(server.command).toEqual([
        `${tree.installPath}/bin/server`,
        "--config",
        `${tree.installPath}/config.json`,
      ])
    }
  })

  it("expands allowed env vars and leaves blocked ones empty", async () => {
    const tree = buildPluginTree({
      name: "demo",
      components: {
        mcp: {
          mcpServers: {
            envd: {
              command: "npx",
              env: {
                HOME_DIR: "${HOME}",
                SECRET_KEY: "${MY_SECRET}",
              },
            },
          },
        },
      },
    })
    cleanups.push(tree.cleanup)

    const servers = await loadPluginMcpServers(tree.plugins)
    const server = servers["demo:envd"]!
    expect(server.type).toBe("local")
    if (server.type === "local") {
      const environment = server.environment ?? {}
      // HOME is allowlisted -> expands to the real home dir
      expect(environment.HOME_DIR).toBe(process.env.HOME ?? "")
      // MY_SECRET is not allowlisted -> expands to empty string
      expect(environment.SECRET_KEY).toBe("")
    }
  })

  it("returns an empty map when the plugin has no .mcp.json", async () => {
    const tree = buildPluginTree({ name: "bare" })
    cleanups.push(tree.cleanup)

    const servers = await loadPluginMcpServers(tree.plugins)
    expect(servers).toEqual({})
  })
})
