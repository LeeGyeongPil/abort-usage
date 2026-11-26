/** Turns a model call's prompt and tool definitions into text that can be token-estimated. */

export interface PromptText {
  /** Text that counts towards input tokens. */
  text: string;
  /** Number of messages, each adds a small fixed overhead for role markers. */
  messageCount: number;
  /** Images / files / other parts that could not be counted. */
  nonTextParts: number;
}

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** Serialises one content part; returns '' for parts that carry no countable text. */
function partText(part: unknown, acc: { nonText: number }): string {
  if (typeof part === 'string') return part;
  if (!isObject(part)) return '';
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return typeof part.text === 'string' ? part.text : '';
    case 'tool-call':
      return `${String(part.toolName ?? '')} ${typeof part.input === 'string' ? part.input : safeJson(part.input)}`;
    case 'tool-result': {
      const output = part.output;
      if (isObject(output)) {
        if (output.type === 'content' && Array.isArray(output.value)) {
          return output.value.map((v: unknown) => partText(v, acc)).join('\n');
        }
        return typeof output.value === 'string' ? output.value : safeJson(output.value);
      }
      return safeJson(output);
    }
    case 'tool-approval-response':
      return '';
    case 'image':
    case 'file':
    case 'image-data':
    case 'image-url':
    case 'file-data':
    case 'file-url':
      acc.nonText++;
      return '';
    default:
      // Unknown part types: count their text if they have one, otherwise note that we skipped them.
      if (typeof part.text === 'string') return part.text;
      acc.nonText++;
      return '';
  }
}

/** Serialises `params.prompt` and `params.tools` of a `doStream` call. Never throws. */
export function promptToText(prompt: unknown, tools: unknown): PromptText {
  const acc = { nonText: 0 };
  const pieces: string[] = [];
  let messageCount = 0;

  if (Array.isArray(prompt)) {
    for (const message of prompt) {
      if (!isObject(message)) continue;
      messageCount++;
      const content = message.content;
      if (typeof content === 'string') pieces.push(content);
      else if (Array.isArray(content)) {
        for (const part of content) {
          const t = partText(part, acc);
          if (t) pieces.push(t);
        }
      }
    }
  }

  if (Array.isArray(tools)) {
    for (const t of tools) {
      if (!isObject(t)) continue;
      pieces.push(`${String(t.name ?? '')} ${String(t.description ?? '')} ${safeJson(t.inputSchema)}`);
    }
  }

  return { text: pieces.join('\n'), messageCount, nonTextParts: acc.nonText };
}
