import { execFileSync } from "node:child_process";

function powershell(script) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    { encoding: "utf8", timeout: 15_000, windowsHide: true }
  ).trim();
}

function wslExec(distro, args, user = "root") {
  return execFileSync(
    "wsl.exe",
    ["-d", distro, "-u", user, "--", ...args],
    { encoding: "utf8", timeout: 15_000, windowsHide: true }
  ).trim();
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function getProcesses() {
  const script = [
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize |",
    "ConvertTo-Json -Compress"
  ].join(" ");
  const rows = asArray(JSON.parse(powershell(script) || "[]"));
  return rows.map(row => ({
    pid: Number(row.ProcessId),
    parent_pid: Number(row.ParentProcessId),
    name: row.Name,
    command_line: redactCommandLine(row.CommandLine),
    working_set_mb: Math.round(Number(row.WorkingSetSize || 0) / 1048576)
  }));
}

function redactCommandLine(value) {
  if (!value) return null;
  return String(value)
    .replace(/(api[-_]?key|token|secret)(\s+|=)([^\s"]+)/gi, "$1$2[REDACTED]")
    .replace(/Bearer\s+[^\s"]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

export function getListeningPid(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("invalid endpoint port");
  }
  const script = [
    "$row=$null;",
    `try{$row=Get-NetTCPConnection -State Listen -LocalPort ${port}`,
    "-ErrorAction Stop | Select-Object -First 1}catch{};",
    "if($null -ne $row){$row.OwningProcess}; exit 0"
  ].join(" ");
  const pid = Number(powershell(script));
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`no listening process found on port ${port}`);
  }
  return pid;
}

export function getWslProcesses(distro = "Ubuntu") {
  const text = wslExec(distro, [
    "ps", "-eo", "pid=,ppid=,comm=,rss=,args=", "--sort=pid"
  ]);
  return text.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!match) return null;
    return {
      pid: Number(match[1]),
      parent_pid: Number(match[2]),
      name: match[3],
      working_set_mb: Math.round(Number(match[4]) / 1024),
      command_line: redactCommandLine(match[5])
    };
  }).filter(Boolean);
}

export function getWslListeningPid(port, distro = "Ubuntu") {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("invalid endpoint port");
  }
  const text = wslExec(distro, [
    "bash", "-lc",
    `ss -H -ltnp 'sport = :${port}' 2>/dev/null || true`
  ]);
  const match = text.match(/pid=(\d+)/);
  if (!match) throw new Error(`no WSL listener found on port ${port}`);
  return Number(match[1]);
}

function csvRows(text) {
  return text.split(/\r?\n/).filter(Boolean)
    .map(line => line.split(",").map(value => value.trim()));
}

export function getGpuSnapshot() {
  const gpuText = execFileSync("nvidia-smi", [
    "--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw",
    "--format=csv,noheader,nounits"
  ], { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
  let appsText = "";
  try {
    appsText = execFileSync("nvidia-smi", [
      "--query-compute-apps=pid,process_name,used_gpu_memory",
      "--format=csv,noheader,nounits"
    ], { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
  } catch {
    // WDDM may expose incomplete per-process memory data.
  }
  const gpu = csvRows(gpuText)[0];
  return {
    gpu: {
      name: gpu[0],
      temperature_c: Number(gpu[1]),
      gpu_util_pct: Number(gpu[2]),
      memory_controller_util_pct: Number(gpu[3]),
      vram_used_mb: Number(gpu[4]),
      vram_total_mb: Number(gpu[5]),
      power_draw_w: Number(gpu[6])
    },
    compute_processes: csvRows(appsText).map(row => ({
      pid: Number(row[0]),
      process_name: row[1],
      used_gpu_memory_mb: /^\d/.test(row[2] || "") ? Number(row[2]) : null
    })).filter(row => Number.isInteger(row.pid))
  };
}

export function getWslGpuSnapshot(distro = "Ubuntu") {
  const gpuText = wslExec(distro, ["nvidia-smi",
    "--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw",
    "--format=csv,noheader,nounits"
  ]);
  let appsText = "";
  try {
    appsText = wslExec(distro, ["nvidia-smi",
      "--query-compute-apps=pid,process_name,used_gpu_memory",
      "--format=csv,noheader,nounits"
    ]);
  } catch {
    // WSL/WDDM may omit per-process memory.
  }
  const gpu = csvRows(gpuText)[0];
  return {
    gpu: {
      name: gpu[0],
      temperature_c: Number(gpu[1]),
      gpu_util_pct: Number(gpu[2]),
      memory_controller_util_pct: Number(gpu[3]),
      vram_used_mb: Number(gpu[4]),
      vram_total_mb: Number(gpu[5]),
      power_draw_w: Number(gpu[6])
    },
    compute_processes: csvRows(appsText).map(row => ({
      pid: Number(row[0]),
      process_name: row[1],
      used_gpu_memory_mb: /^\d/.test(row[2] || "") ? Number(row[2]) : null
    })).filter(row => Number.isInteger(row.pid))
  };
}

export function descendantPids(rootPid, processes) {
  const found = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (found.has(process.parent_pid) && !found.has(process.pid)) {
        found.add(process.pid);
        changed = true;
      }
    }
  }
  return found;
}

export function resolveRuntimePid(listenerPid, processes, gpuProcesses) {
  const tree = descendantPids(listenerPid, processes);
  const gpuWorkers = gpuProcesses.filter(row => tree.has(row.pid));
  gpuWorkers.sort((a, b) =>
    (b.used_gpu_memory_mb ?? -1) - (a.used_gpu_memory_mb ?? -1)
  );
  return gpuWorkers[0]?.pid ?? listenerPid;
}

export function buildInspectionSnapshot(
  port,
  runtimePidOverride,
  { environment = "windows", distro = "Ubuntu" } = {}
) {
  const inWsl = environment === "wsl";
  const processes = inWsl ? getWslProcesses(distro) : getProcesses();
  const listener_pid = inWsl
    ? getWslListeningPid(port, distro)
    : getListeningPid(port);
  const gpu = inWsl ? getWslGpuSnapshot(distro) : getGpuSnapshot();
  const runtime_pid = runtimePidOverride ??
    resolveRuntimePid(listener_pid, processes, gpu.compute_processes);
  const tree = descendantPids(listener_pid, processes);
  const relevant = processes.filter(process =>
    tree.has(process.pid) ||
    gpu.compute_processes.some(item => item.pid === process.pid)
  );
  return {
    captured_at: new Date().toISOString(),
    endpoint: {
      host: "127.0.0.1", port, listener_pid, environment,
      distro: inWsl ? distro : null
    },
    gpu,
    relevant_processes: relevant,
    ground_truth: { runtime_pid }
  };
}
