export type AllowedToolPolicy = "default" | "read-only"
export type ToolSelection = AllowedToolPolicy | string[]

export const TOOL_POLICIES: Record<AllowedToolPolicy, string[]> = {
  default: ["read", "bash", "edit", "write"],
  "read-only": ["read", "bash"],
}
export const CHILD_CONTROL_TOOLS = ["suba_done", "suba_notify", "suba_ask"] as const

export function parseToolNames(value: unknown, label = "tools"): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of exact tool names`)
  const names = value.map((entry: unknown, index) => {
    if (typeof entry !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(entry.trim())) {
      throw new Error(`${label}[${index}] must be an exact tool name, without patterns or modifiers`)
    }
    return entry.trim()
  })
  if (new Set(names).size !== names.length) throw new Error(`${label} must not contain duplicates`)
  return names
}

export function resolveToolNames(selection: ToolSelection): string[] {
  const names = Array.isArray(selection) ? parseToolNames(selection) : TOOL_POLICIES[selection]
  if (!names) throw new Error(`unsupported tools policy: ${selection}`)
  // Child lifecycle controls cannot be removed, even by an empty explicit selection.
  return [...new Set([...names, ...CHILD_CONTROL_TOOLS])]
}
