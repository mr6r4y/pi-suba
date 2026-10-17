import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { subaDirectory } from "./paths.ts"
import YAML from "yaml"
import { THINKING_LEVELS, type ThinkingLevel } from "./protocol.ts"
import { parseToolNames, type ToolSelection } from "./tools.ts"

export { TOOL_POLICIES, type AllowedToolPolicy, type ToolSelection } from "./tools.ts"
export interface Profile {
  name: string
  description?: string
  model?: string
  thinking?: ThinkingLevel
  tools: ToolSelection
  extensions: string[]
  loadContext: boolean
  loadSkills: boolean
  systemPrompt: "append" | "replace"
  autoComplete?: boolean
  body: string
  source?: string
}

export const BUILTIN_DEFAULT_PROFILE: Profile = {
  name: "default",
  tools: "default",
  extensions: [],
  loadContext: true,
  loadSkills: true,
  systemPrompt: "append",
  body: "",
}
const KEYS = new Set([
  "name",
  "description",
  "model",
  "thinking",
  "tools",
  "extensions",
  "load-context",
  "load-skills",
  "system-prompt",
  "auto-complete",
])

function scalarString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} must be a non-empty string`)
  return value.trim()
}
function scalarBoolean(value: unknown, key: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`)
  return value
}

function parseTools(value: unknown): ToolSelection {
  if (Array.isArray(value)) return parseToolNames(value)
  const policy = scalarString(value, "tools") ?? "default"
  if (policy === "default" || policy === "read,bash,edit,write") return "default"
  if (policy === "read-only" || policy === "read,bash") return "read-only"
  throw new Error(`unsupported tools policy: ${policy}; use a YAML list for exact tool names`)
}

function parseExtensions(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error("extensions must be an array")
  const sources = value.map((entry: unknown, index) => {
    if (typeof entry !== "string" || !entry.trim())
      throw new Error(`extensions[${index}] must be a non-empty string`)
    return entry.trim()
  })
  if (new Set(sources).size !== sources.length)
    throw new Error("extensions must not contain duplicates")
  return sources
}

export function parseProfile(markdown: string, fallbackName: string, source?: string): Profile {
  let data: Record<string, unknown> = {}
  let body = markdown
  if (markdown.startsWith("---\n")) {
    const end = markdown.indexOf("\n---", 4)
    if (end < 0) throw new Error("frontmatter is missing its closing delimiter")
    const parsed = YAML.parse(markdown.slice(4, end))
    if (parsed && (typeof parsed !== "object" || Array.isArray(parsed)))
      throw new Error("frontmatter must be a mapping")
    data = (parsed ?? {}) as Record<string, unknown>
    body = markdown.slice(end + 4).replace(/^(?:\r?\n)+/, "")
  }
  for (const key of Object.keys(data))
    if (!KEYS.has(key)) throw new Error(`unsupported profile key: ${key}`)
  const thinking = scalarString(data.thinking, "thinking") as ThinkingLevel | undefined
  if (thinking && !THINKING_LEVELS.includes(thinking))
    throw new Error(`invalid thinking level: ${thinking}`)
  const systemPrompt = scalarString(data["system-prompt"], "system-prompt") ?? "append"
  if (systemPrompt !== "append" && systemPrompt !== "replace")
    throw new Error(`invalid system-prompt: ${systemPrompt}`)
  const autoCompleteValue = data["auto-complete"]
  if (autoCompleteValue !== undefined && typeof autoCompleteValue !== "boolean")
    throw new Error("auto-complete must be a boolean")
  if (systemPrompt === "replace" && !body.trim())
    throw new Error("system-prompt replace requires a profile body")
  return {
    name: scalarString(data.name, "name") ?? fallbackName,
    description: scalarString(data.description, "description"),
    model: scalarString(data.model, "model"),
    thinking,
    tools: parseTools(data.tools),
    extensions: parseExtensions(data.extensions),
    loadContext: scalarBoolean(data["load-context"], "load-context", true),
    loadSkills: scalarBoolean(data["load-skills"], "load-skills", true),
    systemPrompt,
    autoComplete: autoCompleteValue as boolean | undefined,
    body,
    source,
  }
}

export async function loadProfiles(
  dir = join(subaDirectory(), "profiles"),
): Promise<Map<string, Profile>> {
  const profiles = new Map<string, Profile>([["default", BUILTIN_DEFAULT_PROFILE]])
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return profiles
    throw error
  }
  for (const name of names.filter((item) => item.endsWith(".md")).sort()) {
    const path = join(dir, name)
    try {
      const profile = parseProfile(await readFile(path, "utf8"), basename(name, ".md"), path)
      if (profiles.has(profile.name) && profile.name !== "default")
        throw new Error(`duplicate profile name: ${profile.name}`)
      profiles.set(profile.name, profile)
    } catch (error) {
      throw new Error(
        `Cannot load profile ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return profiles
}
