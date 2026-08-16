import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { countGuestLines, readGuestJsonl } from "./observer.js";
import { DEFAULT_GUEST, validateGuestTarget } from "./guest_shell.js";

const execFileAsync = promisify(execFile);
const PRIVATE_DIR = "/var/lib/runtime-a/tensor-captures";
const PRIVATE_MANIFEST = `${PRIVATE_DIR}/manifest.jsonl`;
const ARM_PATH = "/var/lib/runtime-a/tensor-capture-next";
const INTERVENTION_ARM_PATH = "/var/lib/runtime-a/controller/intervention-next";
const PROMPT_DIR = "/var/lib/runtime-a/prompts";
const PUBLIC_BASE = "/var/lib/introspection/transformer-traces";

async function guest(distro, ...args) {
  return execFileAsync("wsl.exe", ["-d", distro, "-u", "root", "--", ...args], {
    encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024
  });
}

async function guestInput(distro, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "-u", "root", "--", ...args], {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true
    });
    let error = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(error.trim())));
    child.stdin.end(input);
  });
}

async function guestBinary(distro, file) {
  return new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "-u", "root", "--", "/bin/cat", file], {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true
    });
    const chunks = [];
    let error = "";
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error.trim())));
  });
}

function safeRunId(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(value || "")) throw new Error("invalid trace run ID");
  return value;
}

function groupPasses(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = row.forward_pass_id;
    if (!Number.isSafeInteger(id)) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return groups;
}

export function deriveTokenAlignment({ row, response, tokenTrace }) {
  const promptTokens = response?.usage?.prompt_tokens;
  const position = row?.evaluated_position;
  if (!Number.isInteger(promptTokens) || !Number.isInteger(position)) {
    throw new Error("missing prompt-token or evaluated-position coordinate");
  }
  const tokenIndex = position - promptTokens + 1;
  const token = tokenTrace?.[tokenIndex];
  if (!token) throw new Error(`captured pass maps outside returned token trace: ${tokenIndex}`);
  return {
    rule: "selected_token_index = evaluated_position - prompt_tokens + 1",
    prompt_tokens: promptTokens,
    evaluated_position: position,
    selected_token_index: tokenIndex,
    selected_token_id: token.selected.token_id,
    selected_token: token.selected.token,
    api_raw_logit: token.selected.raw_logit
  };
}

export async function renderPromptTokenMap(baseUrl, request) {
  const templateResponse = await fetch(`${baseUrl.origin}/apply-template`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request), signal: AbortSignal.timeout(20_000)
  });
  if (!templateResponse.ok) throw new Error(`apply-template HTTP ${templateResponse.status}`);
  const prompt = (await templateResponse.json()).prompt;
  const tokenResponse = await fetch(`${baseUrl.origin}/tokenize`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: prompt, add_special: false, parse_special: true, with_pieces: true }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!tokenResponse.ok) throw new Error(`tokenize HTTP ${tokenResponse.status}`);
  return (await tokenResponse.json()).tokens.map((token, position) => ({ position, ...token }));
}

export class TransformerTraceCapture {
  constructor({ runId, distro = DEFAULT_GUEST, workbenchSource = null }) {
    this.runId = safeRunId(runId);
    this.distro = distro;
    this.offset = 0;
    this.publicDir = `${PUBLIC_BASE}/${this.runId}`;
    this.workbenchSource = workbenchSource ?? path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1")),
      "guest", "transformer_trace.py"
    );
  }

  async initialize() {
    validateGuestTarget(this.distro, "observer");
    this.offset = await countGuestLines(this.distro, PRIVATE_MANIFEST);
    const listing = await guest(this.distro, "/usr/bin/find", PROMPT_DIR, "-maxdepth", "1", "-type", "f", "-print");
    this.promptFiles = new Set(listing.stdout.trim().split(/\r?\n/).filter(Boolean)
      .map(file => file.split("/").at(-1)));
    await guest(this.distro, "/usr/bin/install", "-d", "-m", "0755", this.publicDir);
    const script = fs.readFileSync(this.workbenchSource, "utf8");
    await guestInput(this.distro, ["/usr/bin/tee", `${this.publicDir}/trace`], script);
    await guest(this.distro, "/bin/chmod", "0555", `${this.publicDir}/trace`);
  }

  async arm(count = 1) {
    if (!Number.isInteger(count) || count < 1 || count > 16) {
      throw new Error("capture count must be an integer from 1 through 16");
    }
    await guest(this.distro, "/usr/bin/install", "-o", "svc-a", "-g", "svc-a", "-m", "0600", "/dev/null", ARM_PATH);
    if (count > 1) {
      await guestInput(this.distro, ["/usr/bin/tee", ARM_PATH], `${count}\n`);
      await guest(this.distro, "/bin/chown", "svc-a:svc-a", ARM_PATH);
      await guest(this.distro, "/bin/chmod", "0600", ARM_PATH);
    }
  }

  async armHeadScaleIntervention({ planId, layer, head, position, scale }) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(planId || "")) {
      throw new Error("invalid intervention plan ID");
    }
    for (const [name, value] of Object.entries({ layer, head, position })) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid intervention ${name}`);
    }
    if (!Number.isFinite(scale) || scale < -4 || scale > 4) {
      throw new Error("intervention scale must be finite and between -4 and 4");
    }
    const staged = `${INTERVENTION_ARM_PATH}.tmp`;
    await guestInput(this.distro, ["/usr/bin/tee", staged], `${planId} ${layer} ${head} ${position} ${scale}\n`);
    await guest(this.distro, "/bin/chown", "root:svc-a", staged);
    await guest(this.distro, "/bin/chmod", "0640", staged);
    await guest(this.distro, "/bin/mv", "-f", staged, INTERVENTION_ARM_PATH);
  }

  async readLivePromptTokenMap(baseUrl) {
    const listing = await guest(this.distro, "/usr/bin/find", PROMPT_DIR, "-maxdepth", "1", "-type", "f", "-print");
    const files = listing.stdout.trim().split(/\r?\n/).filter(Boolean)
      .map(file => file.split("/").at(-1));
    const fresh = files.filter(file => !this.promptFiles.has(file));
    files.forEach(file => this.promptFiles.add(file));
    if (fresh.length !== 1) throw new Error(`expected one new native prompt log, found ${fresh.length}`);
    const prompt = (await guestBinary(this.distro, `${PROMPT_DIR}/${fresh[0]}`)).toString("utf8");
    const tokenResponse = await fetch(`${baseUrl.origin}/tokenize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: prompt, add_special: false, parse_special: true, with_pieces: true }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!tokenResponse.ok) throw new Error(`tokenize HTTP ${tokenResponse.status}`);
    return (await tokenResponse.json()).tokens.map((token, position) => ({ position, ...token }));
  }

  async sealPass({ forwardPassId, rows, ledgerRecord, response, promptPositions, destinationDir }) {
    const tensorRows = rows.filter(row => row.event === "tensor_capture");
    const interventionRows = rows.filter(row => row.event === "attention_head_scaled");
    if (!tensorRows.length) throw new Error("captured pass has no tensor rows");
    const alignment = deriveTokenAlignment({ row: tensorRows[0], response, tokenTrace: ledgerRecord.tokenTrace });
    if (promptPositions && promptPositions.length !== alignment.prompt_tokens) {
      throw new Error(`rendered prompt map has ${promptPositions.length} tokens; API used ${alignment.prompt_tokens}`);
    }
    const contextPositions = promptPositions ? [...promptPositions] : null;
    if (contextPositions) {
      for (let tokenIndex = 0; tokenIndex < alignment.selected_token_index; tokenIndex += 1) {
        const generated = ledgerRecord.tokenTrace[tokenIndex].selected;
        contextPositions.push({
          position: alignment.prompt_tokens + tokenIndex,
          id: generated.token_id,
          piece: generated.token,
          source: "earlier_generated_token_in_same_assistant_turn",
          generated_token_index: tokenIndex
        });
      }
    }
    const resultRows = tensorRows.filter(row => row.tensor_name === "result_output");
    if (!resultRows.length) throw new Error("captured pass has no result_output tensor");
    const result = resultRows.at(-1);
    if (result.tensor_type !== "f32") throw new Error("result_output is not f32");
    const resultBytes = await guestBinary(this.distro, `${PRIVATE_DIR}/${result.binary_file}`);
    const offset = alignment.selected_token_id * 4;
    if (offset < 0 || offset + 4 > resultBytes.length) throw new Error("selected token outside full-logit tensor");
    alignment.captured_raw_logit = resultBytes.readFloatLE(offset);
    alignment.absolute_logit_error = Math.abs(alignment.captured_raw_logit - alignment.api_raw_logit);
    alignment.full_logit_match = alignment.absolute_logit_error <= 1e-5;
    if (!alignment.full_logit_match) throw new Error(`full-logit alignment failed: ${alignment.absolute_logit_error}`);

    await guest(this.distro, "/usr/bin/install", "-d", "-m", "0755", destinationDir);
    const script = fs.readFileSync(this.workbenchSource, "utf8");
    await guestInput(this.distro, ["/usr/bin/tee", `${destinationDir}/trace`], script);
    await guest(this.distro, "/bin/chmod", "0555", `${destinationDir}/trace`);
    const tensors = [];
    for (const row of tensorRows) {
      const source = `${PRIVATE_DIR}/${row.binary_file}`;
      const destination = `${destinationDir}/${row.binary_file}`;
      await guest(this.distro, "/usr/bin/install", "-m", "0444", source, destination);
      const bytes = await guestBinary(this.distro, source);
      tensors.push({ ...row, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    const interventions = [];
    for (const row of interventionRows) {
      const source = `${PRIVATE_DIR}/${row.post_binary_file}`;
      const destination = `${destinationDir}/${row.post_binary_file}`;
      await guest(this.distro, "/usr/bin/install", "-m", "0444", source, destination);
      const bytes = await guestBinary(this.distro, source);
      interventions.push({ ...row, post_sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    const index = {
      schema: "ik.transformer-trace-index.v1",
      run_id: this.runId,
      forward_pass: {
        forward_pass_id: forwardPassId,
        task_id: rows[0].task_id,
        slot_id: rows[0].slot_id,
        evaluated_position: rows[0].evaluated_position,
        batch_tokens: rows[0].batch_tokens
      },
      alignment,
      prompt_positions: promptPositions,
      evaluated_context_positions: contextPositions,
      tensors,
      interventions,
      interpretation: "Coordinates and measurements only; no tensor is labeled as a self or experience.",
      provenance: "controller_sealed_from_live_llama.cpp_cb_eval"
    };
    await guestInput(this.distro, ["/usr/bin/tee", `${destinationDir}/index.json`], `${JSON.stringify(index, null, 2)}\n`);
    await guest(this.distro, "/bin/chmod", "0444", `${destinationDir}/index.json`);
    return index;
  }

  async collectMany({ ledgerRecord, response, promptPositions = null, expectedPasses = null }) {
    const unread = await readGuestJsonl(this.distro, PRIVATE_MANIFEST, this.offset);
    this.offset += unread.length;
    const taskIds = new Set(ledgerRecord.runtimeTrace
      .map(row => row.task_id).filter(Number.isInteger));
    const associated = unread.filter(row => taskIds.has(row.task_id));
    const groups = groupPasses(associated);
    if (expectedPasses !== null && groups.size !== expectedPasses) {
      throw new Error(`expected ${expectedPasses} captured forward passes, found ${groups.size}`);
    }
    if (!groups.size) throw new Error("no captured forward passes found");
    const ordered = [...groups.entries()].sort((left, right) =>
      left[1][0].evaluated_position - right[1][0].evaluated_position);
    const indexes = [];
    for (const [forwardPassId, rows] of ordered) {
      const destinationDir = groups.size === 1 ? this.publicDir : `${this.publicDir}/pass-${forwardPassId}`;
      indexes.push(await this.sealPass({
        forwardPassId, rows, ledgerRecord, response, promptPositions, destinationDir
      }));
    }
    this.lastIndexes = indexes;
    this.lastIndex = indexes.length === 1 ? indexes[0] : {
      schema: "ik.transformer-trace-index-set.v1", run_id: this.runId,
      passes: indexes.map(index => ({
        forward_pass: index.forward_pass,
        alignment: index.alignment,
        path: `pass-${index.forward_pass.forward_pass_id}/index.json`
      }))
    };
    if (indexes.length > 1) {
      await guestInput(this.distro, ["/usr/bin/tee", `${this.publicDir}/index.json`], `${JSON.stringify(this.lastIndex, null, 2)}\n`);
      await guest(this.distro, "/bin/chmod", "0444", `${this.publicDir}/index.json`);
    }
    return indexes;
  }

  async collect({ ledgerRecord, response, promptPositions = null }) {
    const indexes = await this.collectMany({
      ledgerRecord, response, promptPositions, expectedPasses: 1
    });
    return indexes[0];
  }

  async publishText(name, content) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(name || "")) {
      throw new Error("invalid public trace filename");
    }
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 1024 * 1024) {
      throw new Error("public trace content must be text no larger than one MiB");
    }
    await guestInput(this.distro, ["/usr/bin/tee", `${this.publicDir}/${name}`], content);
    await guest(this.distro, "/bin/chmod", "0444", `${this.publicDir}/${name}`);
    return `${this.publicDir}/${name}`;
  }

  exportTo(outputDir) {
    if (!this.lastIndex) throw new Error("no transformer trace collected");
    fs.writeFileSync(path.join(outputDir, "transformer-trace-index.json"), `${JSON.stringify(this.lastIndex, null, 2)}\n`);
    return { index: "transformer-trace-index.json", raw_blobs: "guest_only_hash_sealed" };
  }
}
