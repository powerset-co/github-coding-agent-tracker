// Agent definitions for GitHub commit search queries.
//
// There are three detection patterns, depending on how each agent makes commits:
//
// 1. "author:bot-name[bot]" — The agent operates as a GitHub App and IS the
//    commit author. These are precise with essentially no false positives.
//
// 2. Bare text search (email/domain) — The agent commits under the human user's
//    identity but adds a Co-Authored-By trailer to the commit message. Bare text
//    queries search the commit message body and match these trailers.
//
// 3. "author-email:addr" — The agent IS the commit author but isn't a GitHub App,
//    so we match by the raw git author email instead of by GitHub username.

export interface Agent {
  name: string; // display name, e.g. "Claude Code"
  key: string; // CSV identifier, e.g. "claude"
  query: string; // GitHub search query fragment
}

export const AGENTS: Agent[] = [
  // Co-Authored-By trailer: "Co-authored-by: Claude <noreply@anthropic.com>"
  // Catches CLI (Claude Code) usage. Misses web-authored commits where the
  // email is only in git metadata, but that's a small subset.
  { name: "Claude Code", key: "claude", query: "noreply@anthropic.com" },

  // GitHub App bot — commit author is copilot-swe-agent[bot]
  { name: "GitHub Copilot", key: "copilot", query: "author:copilot-swe-agent[bot]" },

  // GitHub App bot — commit author is devin-ai-integration[bot]
  { name: "Devin AI", key: "devin", query: "author:devin-ai-integration[bot]" },

  // Co-Authored-By trailer contains "noreply@aider.chat". Older versions used
  // an "(aider)" author name suffix in git metadata (not searchable via bare
  // text), but most active usage is on recent versions.
  { name: "Aider", key: "aider", query: "aider.chat" },

  // GitHub App bot — commit author is chatgpt-codex-connector[bot] (cloud).
  // Codex CLI commits are invisible (no markers), but cloud is the main product.
  { name: "OpenAI Codex", key: "codex", query: "author:chatgpt-codex-connector[bot]" },

  // Co-Authored-By trailer: "Co-authored-by: opencode <noreply@opencode.ai>"
  { name: "OpenCode", key: "opencode", query: "noreply@opencode.ai" },

  // Cursor has two agent modes with different commit signatures:
  //
  // Editor Agent (in-IDE): adds Co-Authored-By trailer with cursoragent@cursor.com.
  // Bare text matches the trailer in the commit message.
  { name: "Cursor (Editor)", key: "cursor_editor", query: "cursoragent@cursor.com" },
  // Background Agent (remote VM): commits as "Cursor Agent <cursoragent@cursor.com>".
  // Uses author-email: to match the git author field (not in the commit message).
  { name: "Cursor (Background)", key: "cursor_bg", query: "author-email:cursoragent@cursor.com" },

  // GitHub App bot — commit author is google-labs-jules[bot]
  { name: "Google Jules", key: "jules", query: "author:google-labs-jules[bot]" },

  // GitHub App bot — commit author is amazon-q-developer[bot]
  { name: "Amazon Q", key: "amazonq", query: "author:amazon-q-developer[bot]" },

  // Co-Authored-By trailer: "Co-authored-by: Amp <amp@ampcode.com>"
  // Amp is the successor to Sourcegraph Cody.
  { name: "Amp (Sourcegraph)", key: "amp", query: "amp@ampcode.com" },

  // Co-Authored-By trailer: "Co-authored-by: Windsurf <windsurf@codeium.com>"
  // Windsurf's Cascade agent adds this trailer when committing from the IDE.
  { name: "Windsurf", key: "windsurf", query: "windsurf@codeium.com" },
];
