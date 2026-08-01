// Flow editor types and helpers.
// The whole UI is a structured view over this JSON, which lives in flows.draft_json.

export type NodeType =
  | "disclosure"
  | "agent_speaks"
  | "listen"
  | "decision"
  | "lookup"
  | "knowledge"
  | "followup"
  | "handoff"
  | "switch_language"
  | "end_call";

export interface FlowNode {
  id: string;
  type: NodeType;
  config: Record<string, unknown>;
  next: Record<string, string | null>; // outcome_key -> node_id
}

export interface FlowVariable {
  name: string;
  type: string;
  source: string;
}

export interface FlowDraft {
  flow_id?: string;
  version: number;
  agent_id: string;
  direction: "outbound" | "inbound";
  language: string;
  entry_node: string | null;
  nodes: FlowNode[];
  variables: FlowVariable[];
}

export interface NodeTypeMeta {
  type: NodeType;
  label: string;
  description: string;
  terminal: boolean;
  /** Ordered list of outcome keys that need a "what happens next" dropdown. */
  outcomes: { key: string; label: string }[];
  defaultConfig: Record<string, unknown>;
}

export const NODE_TYPES: NodeTypeMeta[] = [
  {
    type: "disclosure",
    label: "Disclosure / Consent",
    description: "Read a required disclosure and listen for an opt-out keyword.",
    terminal: false,
    outcomes: [{ key: "next", label: "After disclosure" }],
    defaultConfig: { disclosure_text: "", opt_out_keyword: "stop" },
  },
  {
    type: "agent_speaks",
    label: "Agent Speaks",
    description: "Play a scripted line from the agent.",
    terminal: false,
    outcomes: [{ key: "next", label: "After speaking" }],
    defaultConfig: { prompt_text: "", language_override: "" },
  },
  {
    type: "listen",
    label: "Listen for Answer",
    description: "Capture a user answer into a variable.",
    terminal: false,
    outcomes: [
      { key: "captured", label: "Answer captured" },
      { key: "no_input", label: "No input / silence" },
    ],
    defaultConfig: { capture: "", variable_name: "", max_retries: 2 },
  },
  {
    type: "decision",
    label: "Decision Branch",
    description: "Evaluate a condition and branch.",
    terminal: false,
    outcomes: [
      { key: "true", label: "If true" },
      { key: "false", label: "If false" },
    ],
    defaultConfig: { condition: "" },
  },
  {
    type: "lookup",
    label: "Look Up / Update Record",
    description: "Call an external endpoint to fetch or update a record.",
    terminal: false,
    outcomes: [
      { key: "success", label: "On success" },
      { key: "error", label: "On error" },
    ],
    defaultConfig: { endpoint: "", method: "GET", request_mapping: "" },
  },
  {
    type: "knowledge",
    label: "Answer from Knowledge Base",
    description: "Query a knowledge base and answer from it.",
    terminal: false,
    outcomes: [
      { key: "found", label: "Answer found" },
      { key: "not_found", label: "Nothing found" },
    ],
    defaultConfig: { query_source: "", top_k: 3 },
  },
  {
    type: "followup",
    label: "Send Follow-up Message",
    description: "Send an SMS / WhatsApp follow-up after the call leg.",
    terminal: false,
    outcomes: [
      { key: "sent", label: "Message sent" },
      { key: "failed", label: "Send failed" },
    ],
    defaultConfig: { channel: "sms", template: "", variables: "" },
  },
  {
    type: "handoff",
    label: "Hand Off to Human",
    description: "Transfer to a human teammate. Terminal step.",
    terminal: true,
    outcomes: [],
    defaultConfig: { destination: "", reason_tag: "" },
  },
  {
    type: "switch_language",
    label: "Switch Language",
    description: "Switch the conversation language mid-call.",
    terminal: false,
    outcomes: [{ key: "next", label: "After switching" }],
    defaultConfig: { target_language: "hi-IN", voice_mapping: "" },
  },
  {
    type: "end_call",
    label: "End Call",
    description: "Close out with a final line. Terminal step.",
    terminal: true,
    outcomes: [],
    defaultConfig: { closing_line: "" },
  },
];

export const NODE_TYPE_MAP: Record<NodeType, NodeTypeMeta> = Object.fromEntries(
  NODE_TYPES.map((t) => [t.type, t]),
) as Record<NodeType, NodeTypeMeta>;

export function makeNodeId(): string {
  return (
    "n_" +
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-4)
  );
}

export function createNode(type: NodeType): FlowNode {
  const meta = NODE_TYPE_MAP[type];
  const next: Record<string, string | null> = {};
  for (const o of meta.outcomes) next[o.key] = null;
  return {
    id: makeNodeId(),
    type,
    config: { ...meta.defaultConfig },
    next,
  };
}

export function emptyDraft(agentId: string, language = "en-IN"): FlowDraft {
  return {
    version: 1,
    agent_id: agentId,
    direction: "outbound",
    language,
    entry_node: null,
    nodes: [],
    variables: [],
  };
}

export function normalizeDraft(
  raw: unknown,
  agentId: string,
  language = "en-IN",
): FlowDraft {
  if (!raw || typeof raw !== "object") return emptyDraft(agentId, language);
  const r = raw as Partial<FlowDraft>;
  return {
    version: r.version ?? 1,
    agent_id: r.agent_id ?? agentId,
    direction: r.direction === "inbound" ? "inbound" : "outbound",
    language: r.language ?? language,
    entry_node: r.entry_node ?? null,
    nodes: Array.isArray(r.nodes) ? r.nodes : [],
    variables: Array.isArray(r.variables) ? r.variables : [],
  };
}

export function nodeSummary(node: FlowNode): string {
  const c = node.config as Record<string, string>;
  switch (node.type) {
    case "disclosure":
      return c.disclosure_text || "No disclosure text yet";
    case "agent_speaks":
      return c.prompt_text || "No prompt yet";
    case "listen":
      return c.variable_name
        ? `Captures \"${c.capture || "answer"}\" into ${c.variable_name}`
        : "No capture variable yet";
    case "decision":
      return c.condition || "No condition yet";
    case "lookup":
      return c.endpoint ? `${c.method || "GET"} ${c.endpoint}` : "No endpoint yet";
    case "knowledge":
      return c.query_source || "No knowledge source yet";
    case "followup":
      return c.template ? `${c.channel || "sms"}: ${c.template}` : "No template yet";
    case "handoff":
      return c.destination || "No destination yet";
    case "switch_language":
      return c.target_language ? `Switch to ${c.target_language}` : "No target language";
    case "end_call":
      return c.closing_line || "No closing line yet";
  }
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

export function draftsEqual(a: unknown, b: unknown): boolean {
  try {
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}
