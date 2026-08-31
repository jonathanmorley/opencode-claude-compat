export interface ToolHandlerClient {
  session: {
    messages: (opts: { path: { id: string }; query?: { directory: string } }) => Promise<unknown>
  }
}

export interface ToolHandlerContext {
  directory: string
  worktree: string
  client?: ToolHandlerClient
}
