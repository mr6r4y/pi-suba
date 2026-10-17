import { describe, expect, it } from "vitest"
import { CHILD_CONTROL_TOOLS, parseToolNames, resolveToolNames } from "../src/shared/tools.ts"

describe("tool selections", () => {
  it("expands both historical policies without changing their tools", () => {
    expect(resolveToolNames("default")).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      ...CHILD_CONTROL_TOOLS,
    ])
    expect(resolveToolNames("read-only")).toEqual(["read", "bash", ...CHILD_CONTROL_TOOLS])
  })

  it("treats explicit lists as replacements, not additions to a policy", () => {
    expect(resolveToolNames(["web_search"])).toEqual(["web_search", ...CHILD_CONTROL_TOOLS])
    expect(resolveToolNames([])).toEqual([...CHILD_CONTROL_TOOLS])
  })

  it("adds lifecycle controls once and never mutates the supplied selection", () => {
    const selection = ["read", "suba_ask"]
    expect(resolveToolNames(selection)).toEqual(["read", "suba_ask", "suba_done", "suba_notify"])
    expect(selection).toEqual(["read", "suba_ask"])
  })

  it("accepts unknown extension names without pretending the tools exist yet", () => {
    expect(parseToolNames([" extension_tool ", "mcp__server__tool", "my-tool"])).toEqual([
      "extension_tool",
      "mcp__server__tool",
      "my-tool",
    ])
  })

  it.each([
    { value: null },
    { value: "read" },
    { value: [null] },
    { value: [42] },
    { value: [""] },
    { value: ["read", " read "] },
    { value: ["read,bash"] },
    { value: ["read write"] },
    { value: ["*"] },
    { value: ["+read"] },
    { value: ["-write"] },
  ])("rejects malformed selections: $value", ({ value }) => {
    expect(() => parseToolNames(value)).toThrow(/tools/)
  })
})
