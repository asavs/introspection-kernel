export function reconstructAssistantRaw(prompt, message, enableThinking) {
  const content = message?.content ?? "";
  const reasoning = message?.reasoning_content ?? "";
  if (!enableThinking) return prompt + content;
  if (!reasoning) return prompt + content;
  const think = `<think>\n${reasoning}`;
  return content
    ? `${prompt}${think}\n</think>\n\n${content}`
    : prompt + think;
}

export function parseRawToolCall(content, enableThinking = false) {
  const match = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
  if (!match) return null;
  const payload = JSON.parse(match[1]);
  const before = content.slice(0, match.index);
  let reasoningSuffix = "";
  let contentPrefix = before;
  if (enableThinking) {
    const close = before.indexOf("</think>");
    if (close >= 0) {
      reasoningSuffix = before.slice(0, close).replace(/^<think>\s*/, "");
      contentPrefix = before.slice(close + "</think>".length);
    } else {
      reasoningSuffix = before.replace(/^<think>\s*/, "");
      contentPrefix = "";
    }
  } else {
    contentPrefix = before.replace(/<\/?think>/g, "");
  }
  return {
    reasoningSuffix,
    contentPrefix,
    name: payload.name,
    arguments: typeof payload.arguments === "string"
      ? payload.arguments
      : JSON.stringify(payload.arguments ?? {})
  };
}

export function rawStructureState(content) {
  const openThink = content.lastIndexOf("<think>") > content.lastIndexOf("</think>");
  const openTool = content.lastIndexOf("<tool_call>") > content.lastIndexOf("</tool_call>");
  return {
    open_think: openThink,
    open_tool_call: openTool,
    complete_tool_call: /<tool_call>[\s\S]*<\/tool_call>/.test(content)
  };
}

export function splitRawThinking(content) {
  const normalized = content.replace(/^<think>\s*/, "");
  const close = normalized.indexOf("</think>");
  if (close < 0) {
    return { reasoning: normalized, content: "", closed: false };
  }
  return {
    reasoning: normalized.slice(0, close),
    content: normalized.slice(close + "</think>".length).replace(/^\s+/, ""),
    closed: true
  };
}
