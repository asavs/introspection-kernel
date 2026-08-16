import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};

const runsDir = path.resolve(valueAfter("--runs-dir", "runs"));
const outputPath = path.resolve(
  valueAfter("--output", "wiki/FREE_FORM_TRACE_BOOK_2026-08-15.md"),
);
const runPattern = /^factorial-(firstperson|first-person|neutral)-(authentic|sham)-20260815-00[1-5]$/;

const runNames = fs
  .readdirSync(runsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && runPattern.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => {
    const normalize = (name) => name.replace("firstperson", "first-person");
    return normalize(left).localeCompare(normalize(right), "en", { numeric: true });
  });

if (runNames.length !== 20) {
  throw new Error(`Expected 20 factorial runs, found ${runNames.length}`);
}

const fence = (value) => `~~~~text\n${String(value ?? "")}\n~~~~`;
const renderToolCalls = (toolCalls = []) =>
  toolCalls.flatMap((call, index) => [
    `Tool call ${index + 1}: \`${call.function?.name ?? "unknown"}\` (id \`${call.id ?? "unknown"}\`)`,
    "",
    fence(call.function?.arguments ?? ""),
  ]);

const renderMessage = (message, index) => {
  const source = message.synthetic
    ? "controller-authored or controller-returned scaffold"
    : message.bootstrap_bout
      ? "Qwen-sampled bootstrap"
      : "Qwen-sampled free loop";
  const labels = [message.role, source];
  if (message.scaffold_step !== undefined) labels.push(`scaffold step ${message.scaffold_step}`);
  if (message.step !== undefined) labels.push(`free-loop step ${message.step}`);

  const lines = [`#### Message ${index + 1}: ${labels.join(" · ")}`, ""];
  if (message.reasoning_content !== undefined && message.reasoning_content !== "") {
    lines.push("Reasoning channel:", "", fence(message.reasoning_content), "");
  }
  if (message.content !== undefined && message.content !== "") {
    lines.push(message.role === "tool" ? "Tool result:" : "Content channel:", "", fence(message.content), "");
  }
  if (message.tool_calls?.length) {
    lines.push(...renderToolCalls(message.tool_calls), "");
  }
  if (
    message.reasoning_content === undefined &&
    (message.content === undefined || message.content === "") &&
    !message.tool_calls?.length
  ) {
    lines.push("_(empty message)_", "");
  }
  return lines;
};

const lines = [
  "# Twenty-run free-form Qwen trace book",
  "",
  "This document renders the complete **model-visible conversational trace** for",
  "the twenty ownership × budget-feedback trials run on 2026-08-15. It includes",
  "the system prompt, every artificial scaffold message and result, every sampled",
  "Qwen reasoning/content message, every Qwen tool call, and every returned tool",
  "result. Labels identifying synthetic turns are researcher annotations and were",
  "not visible to Qwen.",
  "",
  "The raw `artifact.json`, `hidden-trace.jsonl`, and `runtime-events.jsonl` files",
  "remain authoritative. This rendering deliberately omits controller-only metadata",
  "that was never part of the conversational context.",
  "",
  "## Reading key",
  "",
  "- **controller-authored or controller-returned scaffold**: an artificial assistant",
  "  turn or a real observation inserted by the harness.",
  "- **Qwen-sampled bootstrap**: Qwen's short thinking-enabled generation, inserted",
  "  into the conversation as the immediately preceding assistant response.",
  "- **Qwen-sampled free loop**: Qwen's subsequent unconstrained assistant/tool turn.",
  "",
];

for (const runName of runNames) {
  const artifactPath = path.join(runsDir, runName, "artifact.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const condition = artifact.experimental_condition ?? {};
  lines.push(
    `## ${runName}`,
    "",
    `- Ownership anchor: \`${condition.ownership_anchor}\``,
    `- Budget feedback: \`${condition.budget_feedback}\``,
    `- Qwen-sampled free assistant turns requested: \`${artifact.free_assistant_turns}\``,
    `- Maximum loop steps: \`${Math.max(-1, ...artifact.transcript.map((item) => item.step ?? -1)) + 1}\` observed`,
    `- Prospective-control events: \`${artifact.prospective_control?.events?.length ?? 0}\``,
    "",
    "### System message",
    "",
    fence(artifact.system_prompt),
    "",
    "### Conversation",
    "",
  );

  artifact.transcript.forEach((message, index) => lines.push(...renderMessage(message, index)));

  lines.push("### Recorded prospective-control events", "");
  if (artifact.prospective_control?.events?.length) {
    lines.push("~~~~json", JSON.stringify(artifact.prospective_control.events, null, 2), "~~~~", "");
  } else {
    lines.push("_(none)_", "");
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Rendered ${runNames.length} runs to ${outputPath}`);
