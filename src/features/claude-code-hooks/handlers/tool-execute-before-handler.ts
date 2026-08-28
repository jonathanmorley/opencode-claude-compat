import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "../config"
import { loadPluginExtendedConfig } from "../config-loader"
import {
	executePreToolUseHooks,
	type PreToolUseContext,
} from "../pre-tool-use"
import { cacheToolInput } from "../tool-input-cache"
import type { PluginConfig } from "../types"
import { isHookDisabled } from "../hook-disabled"
import { log } from "../../../shared/logger"
import { replaceToolArgs } from "../../../vendor/utils/replace-tool-args"

function nonBlankString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null
	}

	const trimmed = value.trim()
	return trimmed.length > 0 ? value : null
}

function resolvePreToolUseCwd(
	input: { tool: string; sessionID: string },
	toolInput: Record<string, unknown>,
	ctx: Pick<PluginInput, "directory" | "worktree">,
): string {
	if (input.tool.trim().toLowerCase() !== "bash") {
		return ctx.directory
	}

	const explicitCwd = nonBlankString(toolInput.cwd)
	if (explicitCwd) {
		return explicitCwd
	}

	return nonBlankString(ctx.worktree) ?? ctx.directory
}

export function createToolExecuteBeforeHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { args: Record<string, unknown> },
	): Promise<void> => {
		if (input.tool.trim() === "todowrite" && typeof output.args.todos === "string") {
			let parsed: unknown
			try {
				parsed = JSON.parse(output.args.todos)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				log("todowrite todos JSON parse failed", {
					sessionID: input.sessionID,
					error: errorMessage,
				})
				throw new Error(
					`[todowrite ERROR] Failed to parse todos string as JSON. ` +
						`Received: ${
							output.args.todos.length > 100
								? output.args.todos.slice(0, 100) + "..."
								: output.args.todos
						} ` +
						`Expected: Valid JSON array. Pass todos as an array, not a string.`,
				)
			}

			if (!Array.isArray(parsed)) {
				throw new Error(
					`[todowrite ERROR] Parsed JSON is not an array. ` +
						`Received type: ${typeof parsed}. ` +
						`Expected: Array of todo objects. Pass todos as [{id, content, status, priority}, ...].`,
				)
			}

			replaceToolArgs(output, { todos: parsed })
			log("todowrite: parsed todos string to array", { sessionID: input.sessionID })
		}

		cacheToolInput(input.sessionID, input.tool, input.callID, output.args)

		if (isHookDisabled(config, "PreToolUse")) {
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const preCtx: PreToolUseContext = {
			sessionId: input.sessionID,
			toolName: input.tool,
			toolInput: output.args,
			cwd: resolvePreToolUseCwd(input, output.args, ctx),
			toolUseId: input.callID,
		}

		const result = await executePreToolUseHooks(preCtx, claudeConfig, extendedConfig)

		if (result.decision === "deny") {
			throw new Error(result.reason ?? "Hook blocked the operation")
		}

		if (result.modifiedInput) {
			replaceToolArgs(output, result.modifiedInput as Record<string, unknown>)
		}
	}
}
