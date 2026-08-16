import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_GUEST, validateGuestTarget } from "./guest_shell.js";

const execFileAsync = promisify(execFile);
const PRIVATE_DIR = "/var/lib/runtime-a/slots";
const VISIBLE_ROOT = "/var/lib/introspection/runs";

function safeRunId(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(value || "")) throw new Error("invalid checkpoint run ID");
  return value;
}

async function copyFromGuest(distro, source, destination) {
  await new Promise((resolve, reject) => {
    const input = spawn("wsl.exe", [
      "-d", distro, "-u", "root", "--", "/bin/cat", source
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const output = fs.createWriteStream(destination, { flags: "wx" });
    let stderr = "";
    input.stderr.setEncoding("utf8");
    input.stderr.on("data", chunk => { stderr += chunk; });
    input.on("error", reject);
    output.on("error", reject);
    input.stdout.pipe(output);
    input.on("close", code => {
      if (code !== 0) reject(new Error(`checkpoint export failed (${code}): ${stderr.trim()}`));
    });
    output.on("close", resolve);
  });
}

export class SlotCheckpointManager {
  constructor({ baseUrl, runId, distro = DEFAULT_GUEST, slotId = 0 }) {
    validateGuestTarget(distro, "observer");
    this.baseUrl = new URL(baseUrl);
    this.runId = safeRunId(runId);
    this.distro = distro;
    this.slotId = slotId;
    this.visibleDir = `${VISIBLE_ROOT}/${this.runId}/slot-snapshots`;
    this.records = [];
  }

  async guest(...args) {
    return execFileAsync("wsl.exe", [
      "-d", this.distro, "-u", "root", "--", ...args
    ], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  }

  async initialize() {
    await this.guest("/usr/bin/install", "-d", "-m", "0700", "-o", "svc-a", "-g", "svc-a", PRIVATE_DIR);
    await this.guest("/usr/bin/install", "-d", "-m", "0755", this.visibleDir);
  }

  async post(route, body) {
    const response = await fetch(new URL(route, this.baseUrl.origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok) {
      throw new Error(`slot API HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
    }
    return response.json();
  }

  async waitForHealth(timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(new URL("/health", this.baseUrl.origin), {
          signal: AbortSignal.timeout(2000)
        });
        if (response.ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("runtime did not become healthy after checkpoint pause");
  }

  async save(sequence, ledgerRequestId = null) {
    const stem = `${String(sequence).padStart(4, "0")}-${ledgerRequestId ?? "unlinked"}`;
    const filename = `${this.runId}-${stem}.bin`;
    const privatePath = `${PRIVATE_DIR}/${filename}`;
    const visiblePath = `${this.visibleDir}/${stem}.bin`;
    const api = await this.post(`/slots/${this.slotId}?action=save`, { filename });
    await this.guest("/bin/cp", privatePath, visiblePath);
    await this.guest("/bin/chmod", "0444", visiblePath);
    const { stdout: hashOutput } = await this.guest("/usr/bin/sha256sum", privatePath, visiblePath);
    const hashes = hashOutput.trim().split(/\r?\n/).map(line => line.trim().split(/\s+/)[0]);
    if (hashes.length !== 2 || hashes[0] !== hashes[1]) {
      throw new Error("model-visible checkpoint hash differs from private slot save");
    }
    const record = {
      schema: "ik.slot-checkpoint.v1",
      sequence,
      ledger_request_id: ledgerRequestId,
      slot_id: this.slotId,
      filename,
      private_path: privatePath,
      model_visible_path: visiblePath,
      sha256: hashes[0],
      bytes: api.n_written,
      saved_tokens: api.n_saved,
      save_ms: api.timings?.save_ms ?? null,
      saved_at: new Date().toISOString(),
      visibility: "model_readable_binary_copy_controller_verified"
    };
    this.records.push(record);
    return record;
  }

  async pauseRestartRestore(record) {
    const pausedAt = new Date().toISOString();
    await this.guest("/usr/bin/systemctl", "restart", "runtime-a.service");
    await this.waitForHealth();
    const api = await this.post(`/slots/${this.slotId}?action=restore`, {
      filename: record.filename
    });
    record.pause_resume = {
      mechanism: "systemd_restart_then_llama_slot_restore",
      paused_at: pausedAt,
      restored_at: new Date().toISOString(),
      restored_tokens: api.n_restored,
      bytes_read: api.n_read,
      restore_ms: api.timings?.restore_ms ?? null,
      token_count_identity: api.n_restored === record.saved_tokens
    };
    return record.pause_resume;
  }

  async exportTo(outputDir, rawLimitBytes = 16 * 1024 * 1024) {
    const metadataPath = path.join(outputDir, "slot-checkpoints.json");
    fs.writeFileSync(metadataPath, `${JSON.stringify(this.records, null, 2)}\n`);
    const exported = [];
    for (const record of this.records) {
      if (record.bytes > rawLimitBytes) continue;
      const destination = path.join(outputDir, path.basename(record.model_visible_path));
      await copyFromGuest(this.distro, record.model_visible_path, destination);
      exported.push(path.basename(destination));
    }
    return {
      metadata: path.basename(metadataPath),
      raw_export_limit_bytes: rawLimitBytes,
      raw_exports: exported,
      checkpoint_count: this.records.length
    };
  }
}
