import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { promisify } from "node:util"
const execFileAsync = promisify(execFile)

export interface TmuxTarget {
  paneId: string
}
export type TmuxExec = (args: string[], input?: string) => Promise<string>

export const tmuxExec: TmuxExec = async (args, input) => {
  if (input === undefined) return (await execFileAsync("tmux", args)).stdout.trim()
  const child = execFile("tmux", args)
  child.stdin?.end(input)
  return await new Promise<string>((resolve, reject) => {
    let stdout = "",
      stderr = ""
    child.stdout?.on("data", (data) => (stdout += data))
    child.stderr?.on("data", (data) => (stderr += data))
    child.on("error", reject)
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(stderr.trim() || `tmux exited ${code}`)),
    )
  })
}

export class PartialTmuxTargetError extends AggregateError {
  readonly paneId: string

  constructor(paneId: string, targetError: Error, cleanupError: unknown) {
    super(
      [targetError, cleanupError],
      `Could not configure or remove partial tmux target ${paneId}`,
    )
    this.name = "PartialTmuxTargetError"
    this.paneId = paneId
  }
}

async function rollbackTargetPane(
  paneId: string,
  targetError: unknown,
  run: TmuxExec,
): Promise<never> {
  const original = targetError instanceof Error ? targetError : new Error(String(targetError))
  try {
    await run(["kill-pane", "-t", paneId])
  } catch (cleanupError) {
    throw new PartialTmuxTargetError(paneId, original, cleanupError)
  }
  throw original
}

export async function createTarget(
  parentPane: string,
  command: string,
  run = tmuxExec,
): Promise<TmuxTarget> {
  // Resolve on every launch/resume: the parent may have moved to another session.
  const sessionId = await run(["display-message", "-p", "-t", parentPane, "#{session_id}"])
  const paneId = await run([
    "new-window",
    "-d", // Keep the parent's active window and pane unchanged.
    "-P",
    "-F",
    "#{pane_id}",
    "-t",
    `${sessionId}:`, // Let tmux allocate a free index, including concurrent launches.
    command,
  ])
  try {
    await run(["set-option", "-p", "-t", paneId, "@suba-parent-pane", parentPane])
    return { paneId }
  } catch (error) {
    return rollbackTargetPane(paneId, error, run)
  }
}

export async function paneExists(paneId: string, run = tmuxExec): Promise<boolean> {
  try {
    return (await run(["display-message", "-p", "-t", paneId, "#{pane_id}"])) === paneId
  } catch {
    return false
  }
}

export async function sendToPane(paneId: string, message: string, run = tmuxExec): Promise<void> {
  if (!message.includes("\n")) {
    await run(["send-keys", "-t", paneId, "-l", message])
    await run(["send-keys", "-t", paneId, "Enter"])
    return
  }
  const buffer = `suba-${randomBytes(8).toString("hex")}`
  await run(["load-buffer", "-b", buffer, "-"], message)
  await run(["paste-buffer", "-t", paneId, "-b", buffer, "-p", "-d"])
  await new Promise((resolve) => setTimeout(resolve, 100))
  await run(["send-keys", "-t", paneId, "Enter"])
}
