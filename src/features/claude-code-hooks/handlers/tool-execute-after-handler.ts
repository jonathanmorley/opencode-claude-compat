import { isPlainObject } from "../../../vendor/utils/deep-merge"
import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "../config"
import { loadPluginExtendedConfig } from "../config-loader"
import {
	executePostToolUseHooks,
	type PostToolUseClient,
	type PostToolUseContext,
} from "../post-tool-use"
import { getToolInput } from "../tool-input-cache"
import type { PluginConfig } from "../types"
import { isHookDisabled } from "../hook-disabled"
import { log } from "../../../shared/logger"
import { normalizeHookText, normalizeHookTextList } from "../hook-text"

function getStringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key]
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function getNumberValue(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key]
	return typeof value === "number" ? value : undefined
}

function buildTranscriptToolOutput(outputText: string, metadata: unknown): Record<string, unknown> {
	const compactOutput: Record<string, unknown> = { output: outputText }
	if (!isPlainObject(metadata)) {
		return compactOutput
	}

	const filePath = getStringValue(metadata, "filePath")
		?? getStringValue(metadata, "path")
		?? getStringValue(metadata, "file")
	if (filePath) {
		compactOutput.filePath = filePath
	}

	const sessionId = getStringValue(metadata, "sessionId")
	if (sessionId) {
		compactOutput.sessionId = sessionId
	}

	const agent = getStringValue(metadata, "agent")
	if (agent) {
		compactOutput.agent = agent
	}

	for (const key of ["noopEdits", "deduplicatedEdits", "firstChangedLine"] as const) {
		const value = getNumberValue(metadata, key)
		if (value !== undefined) {
			compactOutput[key] = value
		}
	}

	const filediff = metadata.filediff
	if (isPlainObject(filediff)) {
		const additions = getNumberValue(filediff, "additions")
		const deletions = getNumberValue(filediff, "deletions")
		if (additions !== undefined || deletions !== undefined) {
			compactOutput.filediff = {
				...(additions !== undefined ? { additions } : {}),
				...(deletions !== undefined ? { deletions } : {}),
			}
		}
	}

	return compactOutput
}

function appendHookSections(outputText: string, sections: readonly (string | undefined)[]): string {
	const normalizedSections = normalizeHookTextList(sections)
	if (normalizedSections.length === 0) {
		return outputText
	}
	if (outputText.length === 0) {
		return normalizedSections.join("\n\n")
	}
	return [outputText, ...normalizedSections].join("\n\n")
}

export function createToolExecuteAfterHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown } | undefined,
	): Promise<void> => {
		if (!output) {
			return
		}

		const cachedInput = getToolInput(input.sessionID, input.tool, input.callID) || {}

		if (isHookDisabled(config, "PostToolUse")) {
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const postClient: PostToolUseClient = {
			session: {
				messages: (opts) => ctx.client.session.messages(opts),
			},
		}

		const postCtx: PostToolUseContext = {
			sessionId: input.sessionID,
			toolName: input.tool,
			toolInput: cachedInput,
			toolOutput: {
				title: input.tool,
				output: output.output,
				metadata: output.metadata as Record<string, unknown>,
			},
			cwd: ctx.directory,
			toolUseId: input.callID,
			client: postClient,
			permissionMode: "bypassPermissions",
		}

		const result = await executePostToolUseHooks(postCtx, claudeConfig, extendedConfig)

		if (result.block) {
			log("PostToolUse hook blocked tool result", {
				sessionID: input.sessionID,
				reason: result.reason,
			})
		}

		output.output = appendHookSections(output.output, [
			...(result.warnings ?? []),
			...(normalizeHookText(result.additionalContext) === undefined ? [] : [result.additionalContext]),
			...(result.message === undefined ? [] : [result.message]),
		])
	}
}
