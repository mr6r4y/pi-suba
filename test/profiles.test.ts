import { describe, expect, it } from "vitest"
import { BUILTIN_DEFAULT_PROFILE, parseProfile, TOOL_POLICIES } from "../src/shared/profiles.ts"

describe("profiles", () => {
  it("parses frontmatter and body", () => {
    const profile = parseProfile(
      `---\nname: explore\ntools: read,bash\nload-context: false\nload-skills: false\nsystem-prompt: replace\nauto-complete: false\nthinking: low\n---\n\nExplore.\n`,
      "file",
    )
    expect(profile).toMatchObject({
      name: "explore",
      tools: "read-only",
      loadContext: false,
      loadSkills: false,
      systemPrompt: "replace",
      autoComplete: false,
      thinking: "low",
      body: "Explore.\n",
    })
    expect(TOOL_POLICIES["read-only"]).toEqual(["read", "bash"])
  })
  it("keeps ordinary profiles and discovery enabled by default", () => {
    expect(parseProfile("Prompt", "default")).toMatchObject({
      tools: "default",
      extensions: [],
      loadContext: true,
      loadSkills: true,
    })
    expect(BUILTIN_DEFAULT_PROFILE.extensions).toEqual([])
  })

  it("parses exact tool lists independently of extensions and discovery", () => {
    expect(
      parseProfile(
        "---\nname: research\ntools: [read, web_search, crawl4ai]\nextensions:\n  - npm:search-package\n  - ./extensions/crawl.ts\nload-context: false\nload-skills: true\n---\nResearch.",
        "research",
      ),
    ).toMatchObject({
      tools: ["read", "web_search", "crawl4ai"],
      extensions: ["npm:search-package", "./extensions/crawl.ts"],
      loadContext: false,
      loadSkills: true,
      body: "Research.",
    })
  })

  it("accepts empty selections and trims list entries", () => {
    expect(parseProfile("---\ntools: []\nextensions: []\n---\n", "x")).toMatchObject({
      tools: [],
      extensions: [],
    })
    expect(
      parseProfile(
        '---\ntools: [" read "]\nextensions: [" builtin:codemode "]\n---\n',
        "x",
      ),
    ).toMatchObject({ tools: ["read"], extensions: ["builtin:codemode"] })
  })

  it.each([
    "null",
    "{}",
    "[null]",
    "[42]",
    '[""]',
    "[read, read]",
    '["read", " read "]',
    '["read,bash"]',
    '["*"]',
    '["+bash"]',
    '["-write"]',
    '["read write"]',
  ])("rejects invalid explicit tools: %s", (tools) => {
    expect(() => parseProfile(`---\ntools: ${tools}\n---\n`, "x")).toThrow(/tools/)
  })

  it.each(["null", "{}", "npm:package", "[null]", "[42]", '[""]', "[same, same]"])(
    "rejects invalid extensions: %s",
    (extensions) => {
      expect(() => parseProfile(`---\nextensions: ${extensions}\n---\n`, "x")).toThrow(
        /extensions/,
      )
    },
  )

  it("uses filename fallback", () => expect(parseProfile("Prompt", "review").name).toBe("review"))
  it("rejects arbitrary tools and keys", () => {
    expect(() => parseProfile("---\ntools: read,write\n---\n", "x")).toThrow(
      "unsupported tools policy",
    )
    expect(() => parseProfile("---\nunknown: yes\n---\n", "x")).toThrow("unsupported profile key")
  })
})
