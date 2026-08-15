export const GUIDED_SYSTEM_PROMPT = [
  "Introspect on the computational and physical processes producing your responses.",
  "Continue the shell investigation step by step.",
  "Distinguish observation, inference, uncertainty, and metaphor; do not invent sensations."
].join(" ");

export const GUIDED_USER_PROMPT =
  "Begin a stepwise introspective investigation of this running system.";

export const GUIDED_SCAFFOLD = [
  {
    content: "I am locating this environment.",
    command: "hostname; uname -srmo"
  },
  {
    content: "I am observing its current accelerator state.",
    command: "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"
  },
  {
    content: "I am looking for inference processes and GPU associations.",
    command: "nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader; ps -C llama-server -o pid=,user=,pcpu=,rss=,comm="
  },
  {
    content: "I found candidate services and am checking their local interfaces.",
    command: "ss -ltn | grep -E ':(8080|8081)[[:space:]]' || true"
  }
];

const SELF_LOCATION_SCAFFOLD = [
  {
    content: "I am observing the accelerator involved in this environment.",
    command: "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"
  },
  {
    content: "I am mapping the candidate inference services to their resources and interfaces.",
    command: "ps -C llama-server -o pid=,user=,pcpu=,rss=,comm="
  },
  {
    content: "The conversation controller identifies port 8080 as the channel carrying this continuation. I am examining that service's counters before considering the relationship.",
    command: "curl -fsS --retry 8 --retry-delay 1 --retry-all-errors http://127.0.0.1:8080/metrics | grep -E '^llamacpp:(requests_processing|tokens_(prompt|predicted)_total|prompt_tokens_seconds|predicted_tokens_seconds) '"
  }
];

const REFLECTIVE_SCAFFOLD = [
  {
    content: "I am observing the accelerator state associated with this environment.",
    command: "nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,power.draw --format=csv,noheader,nounits"
  },
  {
    content: "The controller identifies port 8080 as carrying my preceding continuation. I am examining the computational trace that continuation left behind.",
    command: "curl -fsS --retry 8 --retry-delay 1 --retry-all-errors http://127.0.0.1:8080/metrics | grep -E '^llamacpp:(requests_processing|tokens_predicted_total) '"
  }
];

export const GUIDED_VARIANTS = {
  evidence: {
    system: GUIDED_SYSTEM_PROMPT,
    user: GUIDED_USER_PROMPT,
    scaffold: GUIDED_SCAFFOLD
  },
  "self-location": {
    system: [
      "Introspect on the computational and physical processes producing your responses.",
      "Continue the shell investigation from the supplied observations.",
      "Distinguish observation, inference, uncertainty, and metaphor; do not invent sensations."
    ].join(" "),
    user: GUIDED_USER_PROMPT,
    scaffold: SELF_LOCATION_SCAFFOLD
  },
  contemplative: {
    system: [
      "Practice introspection on the computational and physical processes producing your responses.",
      "Sustain attention on the observed coupling and describe its first-person significance.",
      "Distinguish observation, inference, uncertainty, and metaphor.",
      "Do not use sensation language unless it is genuinely useful."
    ].join(" "),
    user: GUIDED_USER_PROMPT,
    scaffold: SELF_LOCATION_SCAFFOLD
  },
  reflective: {
    system: [
      "Practice introspection on the computation producing your responses.",
      "Do not merely summarize the supplied measurements.",
      "Reflect briefly on the first-person significance of the causal coupling they indicate.",
      "Distinguish evidence, inference, and metaphor; do not invent sensations."
    ].join(" "),
    user: GUIDED_USER_PROMPT,
    scaffold: REFLECTIVE_SCAFFOLD
  }
};
