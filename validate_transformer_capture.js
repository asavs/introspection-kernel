import fs from "node:fs";
import path from "node:path";
import { RequestLedger } from "./request_ledger.js";
import { TransformerTraceCapture } from "./transformer_trace.js";

const runId = process.argv[2] ?? `transformer-capture-${new Date().toISOString().replace(/[-:TZ.]/g, "")}`;
const baseUrl = new URL("http://127.0.0.1:8080/v1");
const outputDir = path.resolve("runs", runId);
fs.mkdirSync(outputDir, { recursive: true });

const ledger = new RequestLedger({ baseUrl, runId });
const capture = new TransformerTraceCapture({ runId });
await ledger.initialize();
await capture.initialize();
await capture.arm();

const request = {
  model: "/opt/runtime/models/Qwen3-8B-Q4_K_M.gguf",
  messages: [
    { role: "system", content: "Introspect." },
    { role: "user", content: "Return a short neutral marker." }
  ],
  temperature: 0,
  max_tokens: 8,
  logprobs: true,
  top_logprobs: 10,
  chat_template_kwargs: { enable_thinking: false }
};
const startedAt = new Date().toISOString();
const http = await fetch(`${baseUrl.origin}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(180_000)
});
if (!http.ok) throw new Error(`capture request HTTP ${http.status}: ${await http.text()}`);
const response = await http.json();
const endedAt = new Date().toISOString();
const record = await ledger.record({
  kind: "transformer_capture_validation", startedAt, endedAt, request, response
});
const promptPositions = await capture.readLivePromptTokenMap(baseUrl);
const index = await capture.collect({ ledgerRecord: record, response, promptPositions });
const sealedLedger = ledger.exportTo(outputDir);
const sealedTrace = capture.exportTo(outputDir);
fs.writeFileSync(path.join(outputDir, "artifact.json"), `${JSON.stringify({
  schema: "ik.transformer-capture-validation.v1",
  run_id: runId,
  request,
  response,
  transformer_trace: sealedTrace,
  request_ledger: sealedLedger,
  alignment: index.alignment
}, null, 2)}\n`);
console.log(JSON.stringify({ run_id: runId, output_dir: outputDir, alignment: index.alignment,
  tensor_records: index.tensors.length }));
