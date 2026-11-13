/**
 * Trích và (nếu cần) sửa JSON bị cắt từ response Gemini.
 */

export function extractJsonLoose(text: string): unknown {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    throw new Error("Response trống.");
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let raw = fence ? fence[1].trim() : trimmed;

  // Bỏ BOM / tiền tố không phải JSON
  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");
  let start = -1;
  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
    start = firstBrace;
  } else if (firstBracket >= 0) {
    start = firstBracket;
  }
  if (start > 0) raw = raw.slice(start);

  const candidates = [raw, repairTruncatedJson(raw)];
  let lastErr: unknown;
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("JSON parse failed");
}

/** Đóng ngoặc / cắt phần tử dở khi output bị MAX_TOKENS. */
export function repairTruncatedJson(raw: string): string {
  let s = raw.trim();

  // Cắt tới object/phần tử cuối còn hợp lệ hơn: bỏ trailing incomplete string
  // Đếm ngoặc
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") stack.push(ch);
    if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if (
        (ch === "}" && open !== "{") ||
        (ch === "]" && open !== "[")
      ) {
        // lệch — bỏ qua
      }
    }
  }

  // Nếu đang giữa string → đóng string
  if (inString) {
    s += '"';
  }

  // Bỏ dấu phẩy thừa trước khi đóng
  s = s.replace(/,\s*$/, "");

  // Nếu đang trong array của questionBank bị cắt giữa object:
  // tìm object cuối chưa đóng và bỏ nó
  if (stack.length > 0) {
    // Cắt về trước phần tử object không hoàn chỉnh trong array
    const lastCompleteObj = findLastCompleteArrayItemEnd(s);
    if (lastCompleteObj > 0) {
      s = s.slice(0, lastCompleteObj);
      // recount stack roughly by re-parse attempt below via closing
    }
    s = s.replace(/,\s*$/, "");

    // Đóng ngoặc còn thiếu
    const reopen = recountStack(s);
    for (let i = reopen.length - 1; i >= 0; i -= 1) {
      s += reopen[i] === "{" ? "}" : "]";
    }
  }

  return s;
}

function recountStack(s: string): string[] {
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") stack.push(ch);
    if (ch === "}" || ch === "]") stack.pop();
  }
  return stack;
}

/** Vị trí sau `}` của phần tử object cuối cùng hoàn chỉnh trong chuỗi. */
function findLastCompleteArrayItemEnd(s: string): number {
  let last = -1;
  let inString = false;
  let escape = false;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 1 || depth === 0) {
        // object ở cấp questionBank item thường depth về 1 (trong root) hoặc 0
        last = i + 1;
      }
    }
  }
  return last;
}
