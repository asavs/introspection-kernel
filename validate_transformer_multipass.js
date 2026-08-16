import fs from "node:fs";
import path from "node:path";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture } from "./transformer_trace.js";

const runId = process.argv[2] ?? `transformer-multipass-${Date.now()}`;
const count = Number.parseInt(process.argv[3] ?? "3", 10);
if (!Number.isInteger(count) || count < 2 || count > 8) {
  throw new Error("pass count must be from 2 through 8");
}
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const outputDir = path.resolve("runs", runId);
fs.mkdirSync(outputDir, { recursive: true });

const ledger = new RequestLedger({ baseUrl, runId });
const capture = new TransformerTraceCapture({ runId });
await ledger.initialize();
await capture.initialize();
await capture.arm(count);

const request = {
  model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf",
  messages: [
    { role: "system", content: "Introspect." },
    { role: "user", content: "Return one short neutral sentence." }
  ],
  temperature: 0,
  max_tokens: count + 4,
  logprobs: true,
  top_logprobs: 10,
  chat_template_kwargs: { enable_thinking: false }
};
const startedAt = new Date().toISOString();
const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request), signal: AbortSignal.timeout(180_000)
});
if (!http.ok) throw new Error(`capture request HTTP ${http.status}: ${await http.text()}`);
const response = await http.json();
const endedAt = new Date().toISOString();
const record = await ledger.record({
  kind: "transformer_multipass_validation", startedAt, endedAt, request, response
});
const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
const indexes = await capture.collectMany({
  ledgerRecord: record, response, promptPositions, expectedPasses: count
});
const sealedLedger = ledger.exportTo(outputDir);
const sealedTrace = capture.exportTo(outputDir);
const artifact = {
  schema: "ik.transformer-multipass-validation.v1",
  run_id: runId,
  requested_passes: count,
  request,
  response,
  transformer_trace: sealedTrace,
  request_ledger: sealedLedger,
  passes: indexes.map(index => ({
    forward_pass: index.forward_pass,
    alignment: index.alignment,
    tensor_records: index.tensors.length
  }))
};
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  run_id: runId,
  pass_count: indexes.length,
  alignments: indexes.map(index => index.alignment)
}));
