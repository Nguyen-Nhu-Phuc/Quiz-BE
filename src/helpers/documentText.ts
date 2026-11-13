/** Đếm marker dạng "Câu 12" / "Câu 12." trong tài liệu gốc. */
export function countCauMarkers(text: string): number {
  const matches = text.match(/\b[Cc]âu\s*\d+\b/g);
  return matches?.length ?? 0;
}

/**
 * Chia text thành các chunk để EXTRACT hết file.
 * Ưu tiên cắt gần biên dòng; overlap để không mất câu giữa chunk.
 */
export function chunkDocumentText(
  text: string,
  chunkSize = 80_000,
  overlap = 2_000,
): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const lastBreak = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\nCâu "),
        window.lastIndexOf("\ncâu "),
        window.lastIndexOf("\n"),
      );
      if (lastBreak > chunkSize * 0.5) {
        end = start + lastBreak;
      }
    }

    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

/** Heuristic mode trước khi gọi Gemini (giảm GENERATE nhầm trên đề tổng hợp). */
export function inferModeHeuristic(text: string): {
  suggested: "EXTRACT" | "GENERATE" | null;
  cauMarkers: number;
} {
  const cauMarkers = countCauMarkers(text);
  const abcdHits = (text.match(/\b[A-D][\.\)\-]\s+/g) ?? []).length;

  if (cauMarkers >= 8 || (cauMarkers >= 3 && abcdHits >= 20)) {
    return { suggested: "EXTRACT", cauMarkers };
  }
  if (cauMarkers === 0 && abcdHits < 8) {
    return { suggested: "GENERATE", cauMarkers };
  }
  return { suggested: null, cauMarkers };
}
