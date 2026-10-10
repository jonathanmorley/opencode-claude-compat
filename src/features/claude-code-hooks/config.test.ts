import { afterEach, describe, expect, it } from "bun:test"
import {
  resetAdditionalAllowedMcpEnvVars,
  setAdditionalAllowedMcpEnvVars,
} from "../claude-code-mcp-loader/configure-allowed-env-vars"
import { mergePluginHooksConfigs } from "./config"

describe("mergePluginHooksConfigs", () => {
  afterEach(() => {
    resetAdditionalAllowedMcpEnvVars()
  })

  describe("#given plugin command and http hook actions", () => {
    it("#when merging plugin hooks #then command actions keep full env and http actions keep the allowlist", () => {
      // given
      setAdditionalAllowedMcpEnvVars(["ACP_TOKEN"])

      // when
      const config = mergePluginHooksConfigs({}, [
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "*",
                hooks: [
                  {
                    type: "command",
                    command: "echo hi",
                    allowedEnvVars: ["SHOULD_NOT_SURVIVE"],
                  },
                  {
                    type: "http",
                    url: "https://hooks.example.com",
                    allowedEnvVars: ["ACP_TOKEN", "SECRET_TOKEN"],
                  },
                ],
              },
            ],
          },
        },
      ])

      // then
      expect(config.PreToolUse?.[0]?.hooks[0]).toEqual({
        type: "command",
        command: "echo hi",
      })
      expect(config.PreToolUse?.[0]?.hooks[1]).toEqual({
        type: "http",
        url: "https://hooks.example.com",
        allowedEnvVars: ["ACP_TOKEN"],
      })
    })
  })
})
