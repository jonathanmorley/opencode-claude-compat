import { describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const enabled = process.env.OPENCODE_HARNESS_TEST === "1"
const run = enabled ? it : it.skip
const repoRoot = join(import.meta.dir, "..")
const v1PluginEntry =
  process.env.OPENCODE_PLUGIN_ENTRY ?? pathToFileURL(join(repoRoot, "dist", "plugin.js")).href
const model = process.env.OPENCODE_HARNESS_MODEL ?? "openai/gpt-5.6-luna-fast"

setDefaultTimeout(30_000)

describe("OpenCode harness compatibility", () => {
  run("preserves the V1 session tools when the plugin is enabled", async () => {
    const binary = requireBinary(process.env.OPENCODE_V1_BIN ?? "opencode")
    const withoutPlugin = await readV1Tools(binary, false)
    const withPlugin = await readV1Tools(binary, true)

    expect(withoutPlugin.length).toBeGreaterThan(0)
    expect(withPlugin).toEqual(withoutPlugin)
  })

  run("preserves the V2 session tools when the plugin is enabled", async () => {
    const binary = requireBinary(process.env.OPENCODE_V2_BIN ?? "opencode2")
    const withoutPlugin = await captureV2Tools(binary, false)
    const withPlugin = await captureV2Tools(binary, true)

    expect(withoutPlugin.length).toBeGreaterThan(0)
    expect(withPlugin).toEqual(withoutPlugin)
  })
})

function requireBinary(binary: string): string {
  if (binary.includes("/") ? !existsSync(binary) : !Bun.which(binary)) {
    throw new Error(`Missing OpenCode binary: ${binary}`)
  }
  return binary
}

async function readV1Tools(binary: string, withPlugin: boolean): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "opencode-claude-v1-"))
  const configDir = join(root, "xdg")
  const configPath = join(configDir, "opencode", "opencode.json")

  try {
    await mkdir(join(configDir, "opencode"), { recursive: true })
    await writeFile(configPath, JSON.stringify(withPlugin ? { plugin: [v1PluginEntry] } : { plugin: [] }))

    const result = await runProcess(binary, ["debug", "agent", "build"], {
      ...isolatedEnvironment(root),
      XDG_CONFIG_HOME: configDir,
    }, root)
    if (result.exitCode !== 0) {
      throw new Error(`OpenCode V1 failed:\n${result.stdout}\n${result.stderr}`)
    }
    if (withPlugin && !`${result.stdout}\n${result.stderr}`.includes("[opencode-claude-compat] plugin loaded")) {
      throw new Error(`OpenCode V1 did not load the plugin:\n${result.stdout}\n${result.stderr}`)
    }

    const start = result.stdout.indexOf("{")
    if (start === -1) throw new Error(`OpenCode V1 returned no JSON:\n${result.stdout}`)
    const agent = JSON.parse(result.stdout.slice(start)) as { tools?: Record<string, boolean> }
    return Object.keys(agent.tools ?? {}).sort()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function captureV2Tools(binary: string, withPlugin: boolean): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "opencode-claude-v2-"))
  const configDir = join(root, "config")
  const provider = startProvider()
  const pluginDir = join(root, "plugin")
  let process: Bun.Subprocess | undefined
  let output: Promise<[string, string, number]> | undefined

  try {
    await mkdir(configDir, { recursive: true })
    if (withPlugin) {
      await mkdir(pluginDir, { recursive: true })
      await writeFile(
        join(pluginDir, "index.js"),
        [
          `import { writeFileSync } from "node:fs"`,
          `import plugin from ${JSON.stringify(pathToFileURL(join(repoRoot, "dist", "plugin.js")).href)}`,
          `const markLoaded = () => writeFileSync(${JSON.stringify(join(root, "plugin-loaded"))}, "loaded")`,
          "export default {",
          "  ...plugin,",
          "  server: async (...args) => { markLoaded(); return plugin.server(...args) },",
          "  setup: async (...args) => { markLoaded(); return plugin.setup(...args) },",
          "}",
        ].join("\n"),
      )
    }
    await writeFile(
      join(configDir, "opencode.json"),
      JSON.stringify({
        model,
        provider: {
          openai: {
            options: {
              apiKey: "test-key",
              baseURL: `${provider.url}v1`,
            },
          },
        },
        plugin: withPlugin ? [pathToFileURL(pluginDir).href] : [],
      }),
    )

    process = Bun.spawn(
      [binary, "run", "--standalone", "--print-logs", "--model", model, "--format", "json", "say hello"],
      {
        cwd: root,
        env: {
          ...isolatedEnvironment(root),
          OPENCODE_CONFIG_DIR: configDir,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    output = Promise.all([
      new Response(process.stdout as ReadableStream<Uint8Array>).text(),
      new Response(process.stderr as ReadableStream<Uint8Array>).text(),
      process.exited,
    ])
    const body = await waitFor(provider.request, 20_000, `OpenCode V2 did not send a model request`)
    process.kill()
    const [stdout, stderr] = await output
    const logs = `${stdout}\n${stderr}`
    if (withPlugin && (!logs.includes("loading plugin") || logs.includes("failed to load plugin"))) {
      throw new Error(`OpenCode V2 did not load the plugin:\n${stdout}\n${stderr}`)
    }
    if (withPlugin && !existsSync(join(root, "plugin-loaded"))) {
      throw new Error(`OpenCode V2 did not invoke the plugin entrypoint:\n${stdout}\n${stderr}`)
    }

    if (!Array.isArray(body.tools)) throw new Error("OpenCode V2 model request did not include tools")
    return body.tools.map(toolName).sort()
  } finally {
    process?.kill()
    await provider.stop()
    await output?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}

function isolatedEnvironment(root: string): Record<string, string | undefined> {
  const env = { ...process.env }
  for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT", "OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME"]) {
    delete env[key]
  }
  return {
    ...env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    CLAUDE_PLUGINS_HOME: join(root, "claude"),
    CLAUDE_SETTINGS_PATH: join(root, "claude", "settings.json"),
    CLAUDE_CONFIG_DIR: join(root, "claude", "config"),
  }
}

async function runProcess(
  binary: string,
  args: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const process = Bun.spawn([binary, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" })
  const output = Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  try {
    const [stdout, stderr, exitCode] = await waitFor(output, 30_000, `OpenCode V1 did not exit`)
    return { stdout, stderr, exitCode }
  } finally {
    process.kill()
    await output.catch(() => undefined)
  }
}

function startProvider() {
  let resolveRequest!: (body: Record<string, unknown>) => void
  const request = new Promise<Record<string, unknown>>((resolve) => {
    resolveRequest = resolve
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(input) {
      try {
        const body = JSON.parse(await input.text()) as Record<string, unknown>
        if (Array.isArray(body.tools)) resolveRequest(body)
      } catch {
        // The harness may probe the provider before sending its model request.
      }
      return new Response("", { status: 200 })
    },
  })
  return { request, url: server.url.href, stop: () => server.stop(true) }
}

function toolName(tool: unknown): string {
  if (typeof tool !== "object" || tool === null) throw new Error("Invalid tool in model request")
  const value = tool as { name?: unknown; id?: unknown; function?: { name?: unknown } }
  if (typeof value.name === "string") return value.name
  if (typeof value.id === "string") return value.id
  if (typeof value.function?.name === "string") return value.function.name
  throw new Error("Tool in model request has no name")
}

async function waitFor<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
