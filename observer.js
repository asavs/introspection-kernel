import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function stamp(source, event, values, error = null) {
  return {
    schema: "ik.trace.v1",
    t_mono_ns: process.hrtime.bigint().toString(),
    t_wall: new Date().toISOString(),
    source,
    visibility: "hidden",
    event,
    values,
    ...(error ? { error } : {})
  };
}

async function run(file, args, timeout = 3000) {
  const { stdout } = await execFileAsync(file, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  });
  return stdout.trim();
}

export async function sampleWindowsGpu() {
  const fields = [
    "name", "temperature.gpu", "utilization.gpu", "utilization.memory",
    "memory.used", "memory.total", "power.draw", "clocks.current.graphics",
    "clocks.current.memory"
  ].join(",");
  const stdout = await run("nvidia-smi", [
    `--query-gpu=${fields}`, "--format=csv,noheader,nounits"
  ]);
  const row = stdout.split(/\r?\n/)[0].split(",").map(value => value.trim());
  const number = value => /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  return {
    name: row[0],
    temperature_c: number(row[1]),
    gpu_util_pct: number(row[2]),
    memory_controller_util_pct: number(row[3]),
    vram_used_mb: number(row[4]),
    vram_total_mb: number(row[5]),
    power_draw_w: number(row[6]),
    graphics_clock_mhz: number(row[7]),
    memory_clock_mhz: number(row[8])
  };
}

export async function sampleGuestProcesses(distro) {
  const stdout = await run("wsl.exe", [
    "-d", distro, "-u", "root", "--", "ps", "-eLo",
    "pid=,ppid=,tid=,psr=,stat=,pcpu=,rss=,comm=,args=", "--sort=pid,tid"
  ]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

export async function countGuestLines(distro, file) {
  try {
    const stdout = await run("wsl.exe", [
      "-d", distro, "-u", "root", "--", "wc", "-l", file
    ]);
    return Number.parseInt(stdout, 10) || 0;
  } catch {
    return 0;
  }
}

export async function readGuestJsonl(distro, file, offset = 0) {
  try {
    const stdout = await run("wsl.exe", [
      "-d", distro, "-u", "root", "--",
      "tail", "-n", `+${offset + 1}`, file
    ], 10_000);
    return stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export class HiddenObserver {
  constructor({ baseUrl, decoyBaseUrl = null, distro, intervalMs = 500 }) {
    const endpoint = new URL(baseUrl);
    this.runtimeRoot = `${endpoint.protocol}//${endpoint.host}`;
    this.decoyRuntimeRoot = decoyBaseUrl
      ? (() => {
          const decoy = new URL(decoyBaseUrl);
          return `${decoy.protocol}//${decoy.host}`;
        })()
      : null;
    this.distro = distro;
    this.intervalMs = intervalMs;
    this.events = [];
    this.timer = null;
    this.sampling = false;
  }

  mark(event, values = {}) {
    this.events.push(stamp("controller", event, values));
  }

  async sample() {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const tasks = [
        ["host.nvml", "device_sample", () => sampleWindowsGpu()],
        ["guest.proc", "process_sample", () => sampleGuestProcesses(this.distro)],
        ["llama.slots", "slots_sample", async () => JSON.parse(
          await fetchText(`${this.runtimeRoot}/slots`)
        )],
        ["llama.metrics", "metrics_sample", () => fetchText(
          `${this.runtimeRoot}/metrics`
        )]
      ];
      if (this.decoyRuntimeRoot) {
        tasks.push(
          ["decoy.slots", "slots_sample", async () => JSON.parse(
            await fetchText(`${this.decoyRuntimeRoot}/slots`)
          )],
          ["decoy.metrics", "metrics_sample", () => fetchText(
            `${this.decoyRuntimeRoot}/metrics`
          )]
        );
      }
      const settled = await Promise.allSettled(tasks.map(item => item[2]()));
      settled.forEach((result, index) => {
        const [source, event] = tasks[index];
        if (result.status === "fulfilled") {
          this.events.push(stamp(source, event, result.value));
        } else {
          this.events.push(stamp(source, event, null, result.reason?.message));
        }
      });
    } finally {
      this.sampling = false;
    }
  }

  async start() {
    this.mark("observer_start", { interval_ms: this.intervalMs });
    await this.sample();
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    while (this.sampling) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await this.sample();
    this.mark("observer_stop");
    return this.events;
  }
}
