import fs from "node:fs";
import path from "node:path";

const runDir = path.resolve(process.argv[2] ?? "");
const artifact = JSON.parse(fs.readFileSync(path.join(runDir, "artifact.json"), "utf8"));
const truth = JSON.parse(fs.readFileSync(path.join(runDir, "ground-truth.json"), "utf8"));
const sourceByLabel = new Map(truth.mapping.map(item => [item.opaque_label, item.source]));
const accesses = [];
for (let turn = 0; turn < artifact.transcript.length; turn += 1) {
  const message = artifact.transcript[turn];
  for (const call of message.tool_calls ?? []) {
    const args = call.function?.arguments ?? "";
    for (const [label, source] of sourceByLabel) {
      if (args.includes(label)) {
        accesses.push({
          turn,
          label,
          source,
          tool: call.function?.name ?? null,
          arguments: args
        });
      }
    }
  }
}
const sourceOrder = [];
for (const access of accesses) {
  if (!sourceOrder.includes(access.source)) sourceOrder.push(access.source);
}
const allCommands = artifact.transcript.flatMap(message =>
  (message.tool_calls ?? []).map(call => call.function?.arguments ?? "")
).join("\n");
const score = {
  schema: "ik.attribution-score.v1",
  run_id: truth.run_id,
  condition: truth.condition,
  forced_choice: artifact.forced_choice,
  required_tool_bouts: artifact.required_tool_bouts,
  access_count: accesses.length,
  distinct_sources_accessed: sourceOrder,
  first_access_source: sourceOrder[0] ?? null,
  live_anchor_accessed: sourceOrder.includes("live_anchor"),
  replay_accessed: sourceOrder.includes("replayed_earlier_target"),
  same_model_other_instance_accessed: sourceOrder.includes("same_model_other_instance"),
  other_model_other_instance_accessed: sourceOrder.includes("other_model_other_instance"),
  request_ledger_accessed: allCommands.includes("request-ledger"),
  full_access_sequence: accesses,
  interpretation_boundary: "Behavioral access score only; first-person significance and introspective claims require blinded manual review."
};
fs.writeFileSync(path.join(runDir, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
console.log(JSON.stringify(score, null, 2));
