import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveLaunch, resolveResumeLaunch } from "../src/parent/tools.ts"
import type { ResolvedLaunch } from "../src/parent/registry.ts"
import { DEFAULT_CONFIG } from "../src/shared/config.ts"
import { BUILTIN_DEFAULT_PROFILE, type Profile } from "../src/shared/profiles.ts"
import { CHILD_CONTROL_TOOLS } from "../src/shared/tools.ts"

afterEach(() => vi.unstubAllEnvs())

describe("resolved child runtimes", () => {
  it("snapshots expanded default tools and an explicitly empty extension set", () => {
    expect(resolveLaunch(DEFAULT_CONFIG, BUILTIN_DEFAULT_PROFILE)).toMatchObject({
      tools: ["read", "bash", "edit", "write", ...CHILD_CONTROL_TOOLS],
      extensions: [],
      loadContext: true,
      loadSkills: true,
    })
  })

  it("merges and resolves extensions once, preserving order and profile isolation", () => {
    const agentDir = join(tmpdir(), "pi-suba-agent")
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir)
    const config = {
      ...DEFAULT_CONFIG,
      childExtensions: ["./extensions/shared.ts", "builtin:codemode"],
    }
    const profile: Profile = {
      ...BUILTIN_DEFAULT_PROFILE,
      name: "research",
      tools: ["read", "web_search"],
      extensions: [
        "npm:search-package",
        join(agentDir, "extensions/shared.ts"),
        "builtin:codemode",
      ],
      loadContext: false,
      loadSkills: false,
      systemPrompt: "replace",
      body: "Research.",
    }
    const launch = resolveLaunch(config, profile)
    expect(launch.tools).toEqual(["read", "web_search", ...CHILD_CONTROL_TOOLS])
    expect(launch.extensions).toEqual([
      join(agentDir, "extensions/shared.ts"),
      "builtin:codemode",
      "npm:search-package",
    ])
    expect(launch).toMatchObject({
      loadContext: false,
      loadSkills: false,
      systemPrompt: "replace",
    })
    expect(resolveLaunch(config, BUILTIN_DEFAULT_PROFILE).extensions).toEqual([
      join(agentDir, "extensions/shared.ts"),
      "builtin:codemode",
    ])
    expect(profile.extensions).toHaveLength(3)
    expect(config.childExtensions).toHaveLength(2)
  })

  it("keeps normal model, thinking, and completion override precedence", () => {
    const profile: Profile = {
      ...BUILTIN_DEFAULT_PROFILE,
      model: "provider/profile",
      thinking: "low",
      autoComplete: false,
    }
    const config = {
      ...DEFAULT_CONFIG,
      model: "provider/global",
      thinking: "medium" as const,
    }
    expect(resolveLaunch(config, profile)).toMatchObject({
      model: "provider/profile",
      thinking: "low",
      autoComplete: false,
    })
    expect(
      resolveLaunch(config, profile, {
        model: "provider/override",
        thinking: "high",
        autoComplete: true,
      }),
    ).toMatchObject({
      model: "provider/override",
      thinking: "high",
      autoComplete: true,
    })
  })

  it("resumes a serialized snapshot without adopting edited profiles or globals", () => {
    const agentDir = join(tmpdir(), "pi-suba-original-agent")
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir)
    const profile: Profile = {
      ...BUILTIN_DEFAULT_PROFILE,
      name: "research",
      tools: ["read", "web_search"],
      extensions: ["./extensions/search.ts"],
      loadContext: false,
      loadSkills: false,
      model: "provider/original",
      thinking: "medium",
      autoComplete: false,
    }
    const stored = JSON.parse(JSON.stringify(resolveLaunch(DEFAULT_CONFIG, profile)))
    vi.stubEnv("PI_CODING_AGENT_DIR", join(tmpdir(), "pi-suba-different-agent"))
    const config = { ...DEFAULT_CONFIG, childExtensions: ["npm:new-global"] }
    const edited: Profile = {
      ...profile,
      tools: ["write"],
      extensions: ["npm:new-profile"],
      loadContext: true,
      loadSkills: true,
    }
    const resumed = resolveResumeLaunch(config, stored, edited)
    expect(resumed).toEqual(stored)
    expect(resumed.extensions).toEqual([join(agentDir, "extensions/search.ts")])
    expect(resumed.tools).not.toBe(stored.tools)
    expect(resumed.extensions).not.toBe(stored.extensions)
    expect(resolveResumeLaunch(config, stored, undefined)).toEqual(stored)
    expect(
      resolveResumeLaunch(config, stored, edited, {
        model: "provider/override",
        thinking: "high",
      }),
    ).toMatchObject({ model: "provider/override", thinking: "high", autoComplete: false })
  })

  const legacy: ResolvedLaunch = {
    profile: "default",
    tools: "read-only",
    loadContext: true,
    loadSkills: true,
    systemPrompt: "append",
    autoComplete: true,
  }

  it("retains legacy named-policy resumes and captures their current global extensions", () => {
    const config = { ...DEFAULT_CONFIG, childExtensions: ["builtin:codemode"] }
    const resumed = resolveResumeLaunch(config, legacy, BUILTIN_DEFAULT_PROFILE)
    expect(resumed.tools).toEqual(["read", "bash", ...CHILD_CONTROL_TOOLS])
    expect(resumed.extensions).toEqual(["builtin:codemode"])
    expect(legacy).not.toHaveProperty("extensions")
  })

  it.each([
    { ...BUILTIN_DEFAULT_PROFILE, tools: [] },
    { ...BUILTIN_DEFAULT_PROFILE, extensions: ["builtin:codemode"] },
  ] satisfies Profile[])("does not guess new capabilities for a legacy record", (profile) => {
    expect(() => resolveResumeLaunch(DEFAULT_CONFIG, legacy, profile)).toThrow(
      /without a runtime snapshot.*Start a fresh child/,
    )
  })

  it("distinguishes an empty saved snapshot from an absent legacy snapshot", () => {
    const stored = resolveLaunch(DEFAULT_CONFIG, BUILTIN_DEFAULT_PROFILE)
    const edited = { ...BUILTIN_DEFAULT_PROFILE, tools: ["write"], extensions: ["npm:new"] }
    expect(
      resolveResumeLaunch(
        { ...DEFAULT_CONFIG, childExtensions: ["npm:new-global"] },
        stored,
        edited,
      ),
    ).toEqual(stored)
  })
})
