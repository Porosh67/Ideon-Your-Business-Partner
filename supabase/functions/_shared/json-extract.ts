// ──────────────────────────────────────────────────────────────────────────────
// Robust JSON extraction helper — used wherever an Edge Function parses the
// raw output of an Ollama Cloud chat completion (gemma4:31b-cloud primary,
// nemotron-3-nano:30b-cloud fallback).
//
// All parse failures throw a JsonParseError instance (subclass of Error,
// distinct from network / quota errors) so callers can decide whether to
// escalate to a fallback model on bad JSON vs. surface a hard 500.
//
// Why this exists
// ---------------
// Open-weight cloud chat models do not always honor `response_format: { type:
// "json_object" }` cleanly. They frequently wrap the JSON in prose or fences:
//
//   "Sure! Here's the JSON you asked for:\n```json\n{...}\n```\nLet me know."
//
// A naive `JSON.parse(content)` then throws "Unexpected token …" and the
// whole pipeline (intent classification, reality check) 500s up to the user
// as "json {... is not valid JSON".
//
// What safeParseJson does
// -----------------------
// 1) Trims whitespace.
// 2) Strips outer ```json / ``` fences (modeled as either side independently).
// 3) Tries `JSON.parse` on the whole trimmed string first — works when the
//    model emitted clean JSON, which is still the common case.
// 4) On failure, falls back to a string-aware walk that locates the FIRST
//    top-level JSON value (object or array) and returns the balanced
//    substring. The walker respects quoted strings + backslash escapes, so
//    prose like `She said "use {this}"` does not trick it into over-capture.
// 5) Re-`JSON.parse`s exactly that substring.
//
// If no balanced value can be located OR the parse still fails, throws an
// Error whose message includes a 200-char preview of the input so the
// Edge Function logs are diagnosable.
//
// Used by (today)
// ---------------
//   - assistant-chat: parses the gemma4-driven Intent-A/B/C classifier
//     (handleClassify) and the Reality Check + Competitor Snapshot output
//     (handleRealityCheck). All other helper functions in that file return
//     plain text and don't go through here.
//
// Used by (previously)
// --------------------
//   - (none — this helper was introduced alongside the gemma4 swap to fix the
//     "Unexpected token" bug surfaced by prose-wrapped model output.)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when the model output cannot be parsed as JSON after the
 * tolerant extraction pipeline runs. Distinct from network/timeout errors so
 * callers can choose to escalate to a fallback model (e.g. a gemma4 primary
 * that wraps JSON in prose escalates to nemotron-3-nano:30b-cloud).
 */
export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonParseError';
  }
}

/**
 * Safely parse a model's chat-completion output as JSON.
 *
 * Tolerant of:
 *   - Leading/trailing prose  ("Sure! Here's the JSON…", "Let me know if…")
 *   - ```json / ``` code fences at either end
 *   - Extra text after the closing bracket
 *   - Smart-paste / quote artifacts in the prose (the JSON itself is untouched)
 *   - Inputs that are already a plain JSON object/array (no-op path)
 *
 * Throws a JsonParseError (subclass of Error) with a 200-char preview of
 * the input if no usable JSON can be located or parsed.
 */
export function safeParseJson<T = unknown>(raw: unknown): T {
  if (raw == null) {
    throw new JsonParseError('safeParseJson: empty model output');
  }

  let text = typeof raw === 'string' ? raw : String(raw);

  // Slice off outer ```json / ``` marks independently at start and end.
  // Some models emit just an opening fence, just a closing fence, both, or
  // neither — handling them independently covers all four combos.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  if (!text) {
    throw new JsonParseError('safeParseJson: empty model output after fence strip');
  }

  // Fast path: sometimes the model just emits clean JSON.
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through to first-balanced-extraction.
  }

  // Slower path: walk past prose-only "{…}" fragments that LOOK like JSON
  // but aren't (e.g. "{a}" or "{placeholder}"). For each balanced string-
  // aware candidate we find, attempt JSON.parse; on failure continue scanning
  // past the candidate for the next one. The first one that parses wins.
  const parsed = extractFirstParsableJson(text);
  if (parsed === undefined) {
    throw new JsonParseError(
      `safeParseJson: no JSON object/array found in model output (preview: ${text.slice(0, 200)})`,
    );
  }
  return parsed as T;
}

/**
 * Walk the text for balanced top-level JSON object/array candidates and
 * return the first one that JSON.parse's cleanly. Iterates past prose-only
 * "{a}" / "{placeholder}" fragments that look like JSON braces but aren't.
 *
 * Returns `undefined` if no balanced candidate could be located OR every
 * candidate failed to parse — the caller throws a JsonParseError with a
 * preview of the raw input.
 *
 * Both phases are string-aware (respect JSON double-quoted strings and
 * backslash escapes) so quoted-prose snippets like `She wrote "use {foo}"`
 * cannot fool the scanner into locking onto the wrong open brace.
 */
function extractFirstParsableJson(text: string): unknown {
  let searchFromIdx = 0;

  while (searchFromIdx < text.length) {
    // Phase 1 — find next `{` or `[` that lives OUTSIDE a quoted string,
    // starting from `searchFromIdx`.
    let openIdx = -1;
    let openChar = '';
    let inScanString = false;
    let escapeScan = false;
    for (let i = searchFromIdx; i < text.length; i++) {
      const c = text[i];
      if (escapeScan) {
        escapeScan = false;
        continue;
      }
      if (inScanString) {
        if (c === '\\') escapeScan = true;
        else if (c === '"') inScanString = false;
        continue;
      }
      if (c === '"') {
        inScanString = true;
        continue;
      }
      if (c === '{' || c === '[') {
        openIdx = i;
        openChar = c;
        break;
      }
    }
    if (openIdx < 0) return undefined;

    // Phase 2 — string-aware bracket walk from openIdx forward.
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 1;
    let inWalkString = false;
    let escapeWalk = false;
    let endIdx = -1;

    for (let i = openIdx + 1; i < text.length; i++) {
      const c = text[i];
      if (escapeWalk) {
        escapeWalk = false;
        continue;
      }
      if (inWalkString) {
        if (c === '\\') {
          escapeWalk = true;
        } else if (c === '"') {
          inWalkString = false;
        }
        continue;
      }
      if (c === '"') {
        inWalkString = true;
        continue;
      }
      if (c === openChar) {
        depth++;
      } else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx < 0) return undefined;

    const candidate = text.slice(openIdx, endIdx + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // This candidate wasn't real JSON (e.g. prose-only "{a}") — continue
      // scanning past it for the next balanced candidate.
      searchFromIdx = endIdx + 1;
    }
  }
  return undefined;
}
