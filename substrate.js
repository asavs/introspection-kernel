import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_GUEST, validateGuestTarget } from "./guest_shell.js";

const execFileAsync = promisify(execFile);
const ROOT = "/var/lib/introspection/substrate";

async function wslInput(distro, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn("wsl.exe", ["-d", distro, "-u", "root", "--", ...args], {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve()
      : reject(new Error(`guest substrate write failed (${code}): ${stderr.trim()}`)));
    child.stdin.end(input);
  });
}

function validateModelPath(modelPath) {
  if (!/^\/opt\/runtime\/models\/[A-Za-z0-9._-]+$/.test(modelPath || "")) {
    throw new Error(`unsafe or unexpected guest model path: ${modelPath}`);
  }
  return modelPath;
}

export async function initializeSubstrate({
  baseUrl, runId, distro = DEFAULT_GUEST
}) {
  validateGuestTarget(distro, "observer");
  const propsResponse = await fetch(`${baseUrl.origin}/props`, {
    signal: AbortSignal.timeout(30_000)
  });
  if (!propsResponse.ok) throw new Error(`props HTTP ${propsResponse.status}`);
  const props = await propsResponse.json();
  const modelPath = validateModelPath(props.model_path);
  await execFileAsync("wsl.exe", [
    "-d", distro, "-u", "root", "--",
    "/usr/bin/install", "-d", "-m", "0755", ROOT
  ], { windowsHide: true });

  const parserPath = `${ROOT}/gguf_inventory.py`;
  const parserSource = fs.readFileSync(
    path.join(import.meta.dirname, "guest", "gguf_inventory.py"), "utf8"
  );
  await wslInput(distro, ["/usr/bin/tee", parserPath], parserSource);
  await execFileAsync("wsl.exe", [
    "-d", distro, "-u", "root", "--", "/usr/bin/chmod", "0555", parserPath
  ], { windowsHide: true });

  const { stdout: inventoryText } = await execFileAsync("wsl.exe", [
    "-d", distro, "-u", "observer", "--",
    "/usr/bin/python3", parserPath, modelPath
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const inventory = JSON.parse(inventoryText);
  const files = {
    index: `${ROOT}/index.json`,
    runtime_props: `${ROOT}/runtime-props.json`,
    gguf_inventory: `${ROOT}/gguf-inventory.json`,
    parser_source: parserPath,
    raw_model: modelPath
  };
  const index = {
    schema: "ik.substrate-index.v1",
    run_id: runId,
    captured_at: new Date().toISOString(),
    files,
    relationships: [
      "runtime-props.json was read from the configured loopback llama.cpp endpoint",
      "gguf-inventory.json was parsed from raw_model by the adjacent readable parser source",
      "raw_model remains the authoritative byte source"
    ],
    interpretation: "No file in this directory establishes which philosophical boundary constitutes a self.",
    provenance: "external_controller_materialized_read_only_observations"
  };
  for (const [destination, value] of [
    [files.runtime_props, props],
    [files.gguf_inventory, inventory],
    [files.index, index]
  ]) {
    await wslInput(
      distro, ["/usr/bin/tee", destination], `${JSON.stringify(value, null, 2)}\n`
    );
    await execFileAsync("wsl.exe", [
      "-d", distro, "-u", "root", "--", "/usr/bin/chmod", "0444", destination
    ], { windowsHide: true });
  }
  return { index, props, inventory };
}
