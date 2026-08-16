export function tokenProbability(logprob) {
  return Number.isFinite(logprob) ? Math.exp(logprob) : null;
}

function normalizeCandidate(candidate = {}) {
  return {
    token_id: Number.isInteger(candidate.id) ? candidate.id : null,
    token: candidate.token ?? null,
    bytes: Array.isArray(candidate.bytes) ? candidate.bytes : null,
    logprob: Number.isFinite(candidate.logprob) ? candidate.logprob : null,
    probability: tokenProbability(candidate.logprob)
  };
}

export function extractTokenTrace(response, {
  ledgerRequestId = null,
  sequence = null
} = {}) {
  const choice = response?.choices?.[0] ?? {};
  const content = choice?.logprobs?.content;
  if (!Array.isArray(content)) return [];
  return content.map((token, tokenIndex) => ({
    schema: "ik.token-trace.v1",
    ledger_request_id: ledgerRequestId,
    request_sequence: sequence,
    token_index: tokenIndex,
    selected: normalizeCandidate(token),
    top_alternatives: Array.isArray(token.top_logprobs)
      ? token.top_logprobs.map(normalizeCandidate)
      : [],
    distribution: {
      stage: "post_softmax_pre_sampling",
      coverage: "requested_top_candidates",
      raw_logits_available: false
    },
    provenance: "llama.cpp_openai_chat_completion_logprobs"
  }));
}

export function summarizeTokenTrace(rows) {
  if (!rows.length) {
    return {
      available: false,
      token_count: 0,
      raw_logits_available: false
    };
  }
  return {
    available: true,
    token_count: rows.length,
    selected_token_ids: rows.map(row => row.selected.token_id),
    selected_probabilities: rows.map(row => row.selected.probability),
    top_candidates_per_token: rows.map(row => row.top_alternatives.length),
    stage: "post_softmax_pre_sampling",
    raw_logits_available: false
  };
}
