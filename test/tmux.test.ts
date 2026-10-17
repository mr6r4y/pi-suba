import { execFile, spawnSync } from "node:child_process"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createTarget,
  paneExists,
  PartialTmuxTargetError,
  sendToPane,
  type TmuxExec,
} from "../src/shared/tmux.ts"
const exec = promisify(execFile)
const socket = `pi-suba-test-${process.pid}`
const tmuxAvailable = spawnSync("tmux", ["-V"]).status === 0
const run: TmuxExec = async (args, input) => {
  if (input === undefined)
    return (await exec("tmux", ["-L", socket, "-f", "/dev/null", ...args])).stdout.trim()
  const child = execFile("tmux", ["-L", socket, "-f", "/dev/null", ...args])
  child.stdin?.end(input)
  return await new Promise((resolve, reject) => {
    let out = "",
      err = ""
    child.stdout?.on("data", (d) => (out += d))
    child.stderr?.on("data", (d) => (err += d))
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err))))
  })
}

describe("tmux target transactions", () => {
  it("creates a detached window in the current parent session and returns its pane", async () => {
    const calls: string[][] = []
    const run: TmuxExec = async (args) => {
      calls.push(args)
      if (args[0] === "display-message") return "$17"
      if (args[0] === "new-window") return "%9"
      if (args[0] === "set-option") return ""
      throw new Error(`Unexpected tmux command: ${args.join(" ")}`)
    }

    expect(await createTarget("%1", "sleep 60", run)).toEqual({ paneId: "%9" })
    expect(calls).toEqual([
      ["display-message", "-p", "-t", "%1", "#{session_id}"],
      ["new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "$17:", "sleep 60"],
      ["set-option", "-p", "-t", "%9", "@suba-parent-pane", "%1"],
    ])
  })

  it("does not create a window when the parent cannot be resolved", async () => {
    const calls: string[][] = []
    const run: TmuxExec = async (args) => {
      calls.push(args)
      throw new Error("parent missing")
    }

    await expect(createTarget("%1", "sleep 60", run)).rejects.toThrow("parent missing")
    expect(calls).toEqual([["display-message", "-p", "-t", "%1", "#{session_id}"]])
  })

  it("does not attempt pane cleanup when window creation fails", async () => {
    const calls: string[][] = []
    const run: TmuxExec = async (args) => {
      calls.push(args)
      if (args[0] === "display-message") return "$1"
      throw new Error("window creation failed")
    }

    await expect(createTarget("%1", "sleep 60", run)).rejects.toThrow("window creation failed")
    expect(calls.map((args) => args[0])).toEqual(["display-message", "new-window"])
  })

  it("removes only the newly created pane when window setup fails", async () => {
    const calls: string[][] = []
    const run: TmuxExec = async (args) => {
      calls.push(args)
      if (args[0] === "display-message") return "$1"
      if (args[0] === "new-window") return "%9"
      if (args[0] === "set-option") throw new Error("configuration failed")
      if (args[0] === "kill-pane") return ""
      throw new Error(`Unexpected tmux command: ${args.join(" ")}`)
    }

    await expect(createTarget("%1", "sleep 60", run)).rejects.toThrow("configuration failed")
    expect(calls.at(-1)).toEqual(["kill-pane", "-t", "%9"])
    expect(calls.some((args) => args[0] === "kill-window")).toBe(false)
  })

  it("reports the live pane and both errors when cleanup fails", async () => {
    const setupError = new Error("configuration failed")
    const cleanupError = new Error("cleanup failed")
    const run: TmuxExec = async (args) => {
      if (args[0] === "display-message") return "$1"
      if (args[0] === "new-window") return "%9"
      if (args[0] === "set-option") throw setupError
      if (args[0] === "kill-pane") throw cleanupError
      throw new Error(`Unexpected tmux command: ${args.join(" ")}`)
    }

    const error = await createTarget("%1", "sleep 60", run).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PartialTmuxTargetError)
    expect((error as PartialTmuxTargetError).paneId).toBe("%9")
    expect((error as PartialTmuxTargetError).errors).toEqual([setupError, cleanupError])
  })

  it("resolves the parent's session again on every launch or resume", async () => {
    const windows: string[][] = []
    let session = "$1"
    const run: TmuxExec = async (args) => {
      if (args[0] === "display-message") return session
      if (args[0] === "new-window") {
        windows.push(args)
        return `%${windows.length + 9}`
      }
      if (args[0] === "set-option") return ""
      throw new Error(`Unexpected tmux command: ${args.join(" ")}`)
    }

    await createTarget("%1", "sleep 60", run)
    session = "$2"
    await createTarget("%1", "sleep 60", run)
    expect(windows.map((args) => args[6])).toEqual(["$1:", "$2:"])
  })

  it("allocates concurrent windows without listing or resizing parent panes", async () => {
    const calls: string[][] = []
    let nextPane = 10
    const run: TmuxExec = async (args) => {
      calls.push(args)
      if (args[0] === "display-message") return args[3] === "%1" ? "$1" : "$2"
      if (args[0] === "new-window") return `%${nextPane++}`
      if (args[0] === "set-option") return ""
      throw new Error(`Unexpected tmux command: ${args.join(" ")}`)
    }

    const targets = await Promise.all([
      createTarget("%1", "sleep 60", run),
      createTarget("%1", "sleep 60", run),
      createTarget("%2", "sleep 60", run),
    ])
    expect(new Set(targets.map((target) => target.paneId)).size).toBe(3)
    expect(calls.filter((args) => args[0] === "new-window").map((args) => args[6])).toEqual([
      "$1:",
      "$1:",
      "$2:",
    ])
    expect(calls.some((args) => ["split-window", "list-panes", "resize-pane"].includes(args[0]!))).toBe(
      false,
    )
  })
})

describe.skipIf(!tmuxAvailable)("tmux integration", () => {
  let parentPane = ""
  beforeAll(async () => {
    parentPane = await run([
      "new-session",
      "-d",
      "-x",
      "200",
      "-y",
      "60",
      "-s",
      "test",
      "-P",
      "-F",
      "#{pane_id}",
      "sleep 60",
    ])
  })
  afterAll(async () => {
    try {
      await run(["kill-server"])
    } catch {}
  })

  it("creates a separate window without changing focus and sends guidance", async () => {
    const parentWindow = await run(["display-message", "-p", "-t", parentPane, "#{window_id}"])
    const activeWindow = await run(["display-message", "-p", "-t", "test:", "#{window_id}"])
    const target = await createTarget(parentPane, "cat", run)
    expect(target.paneId).toMatch(/^%/)
    expect(await paneExists(target.paneId, run)).toBe(true)
    expect(await run(["display-message", "-p", "-t", target.paneId, "#{window_id}"])).not.toBe(
      parentWindow,
    )
    expect(await run(["display-message", "-p", "-t", "test:", "#{window_id}"])).toBe(activeWindow)
    await sendToPane(target.paneId, "one line", run)
    await sendToPane(target.paneId, "second line\nthird line", run)
    await expect
      .poll(() => run(["capture-pane", "-p", "-t", target.paneId]))
      .toContain("third line")
  })

  it("uses the parent's new session after the parent moves, not the historical child window", async () => {
    const root = await run([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "test:",
      "sleep 60",
    ])
    const oldChild = await createTarget(root, "sleep 60", run)
    const oldWindow = await run(["display-message", "-p", "-t", oldChild.paneId, "#{window_id}"])
    const parentWindow = await run(["display-message", "-p", "-t", root, "#{window_id}"])
    await run(["new-session", "-d", "-s", "moved", "sleep 60"])
    await run(["move-window", "-d", "-s", parentWindow, "-t", "moved:"])
    const session = await run(["display-message", "-p", "-t", root, "#{session_id}"])
    const child = await createTarget(root, "sleep 60", run)
    expect(await run(["display-message", "-p", "-t", child.paneId, "#{session_id}"])).toBe(session)
    const window = await run(["display-message", "-p", "-t", child.paneId, "#{window_id}"])
    expect(window).not.toBe(parentWindow)
    expect(window).not.toBe(oldWindow)
    expect(await run(["display-message", "-p", "-t", oldChild.paneId, "#{session_name}"])).toBe(
      "test",
    )
    expect(await run(["display-message", "-p", "-t", oldChild.paneId, "#{window_id}"])).toBe(
      oldWindow,
    )
  })

  it("creates distinct concurrent windows while preserving the parent's existing layout", async () => {
    const root = await run([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      "test:",
      "sleep 60",
    ])
    await run(["split-window", "-h", "-d", "-p", "20", "-t", root, "sleep 60"])
    const session = await run(["display-message", "-p", "-t", root, "#{session_id}"])
    const parentWindow = await run(["display-message", "-p", "-t", root, "#{window_id}"])
    const layout = await run(["display-message", "-p", "-t", root, "#{window_layout}"])
    const panes = await run(["list-panes", "-t", parentWindow, "-F", "#{pane_id}"])
    const children = await Promise.all([
      createTarget(root, "sleep 60", run),
      createTarget(root, "sleep 60", run),
      createTarget(root, "sleep 60", run),
    ])
    const windows = await Promise.all(
      children.map((child) => run(["display-message", "-p", "-t", child.paneId, "#{window_id}"])),
    )
    expect(new Set(windows).size).toBe(3)
    expect(windows).not.toContain(parentWindow)
    for (const child of children) {
      expect(await run(["display-message", "-p", "-t", child.paneId, "#{session_id}"])).toBe(session)
      expect(await run(["display-message", "-p", "-t", child.paneId, "#{@suba-parent-pane}"])).toBe(
        root,
      )
    }
    for (const window of windows) {
      expect((await run(["list-panes", "-t", window, "-F", "#{pane_id}"])).split("\n")).toHaveLength(
        1,
      )
    }
    expect(await run(["display-message", "-p", "-t", root, "#{window_layout}"])).toBe(layout)
    expect(await run(["list-panes", "-t", parentWindow, "-F", "#{pane_id}"])).toBe(panes)
  })
})
