import type { ToolHandlerClient, ToolHandlerContext } from "./features/claude-code-hooks/handlers/context"

export type { ToolHandlerClient }

/**
 * The small part of the V1 plugin input used by this compatibility layer.
 * Keeping this seam local lets the V1 and V2 entrypoints use different host
 * packages without making either entrypoint depend on the other contract.
 */
export interface V1PluginInput extends ToolHandlerContext {
  client: ToolHandlerClient
}

export interface V1Hooks {
  config?: (config: unknown) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown } | undefined,
  ) => Promise<void>
}

export type V1Plugin = (input: V1PluginInput) => Promise<V1Hooks>
