/**
 * Chuẩn hóa stem để lọc trùng (ZERO_NEAR_DUPLICATE).
 * Xóa (mã số #…), #digits, "Câu N", số thứ tự đầu câu; bỏ dấu câu thừa; gộp khoảng trắng.
 */
export function normalizeStem(stem: string): string {
  let s = stem.toLowerCase().normalize("NFC");

  s = s.replace(/\(mã\s*số\s*#?\s*\d+\)/gi, " ");
  s = s.replace(/mã\s*số\s*#?\s*\d+/gi, " ");
  s = s.replace(/#\d+/g, " ");
  s = s.replace(/^\s*câu\s*\d+\s*[\.\:\-\)]*\s*/i, " ");
  s = s.replace(/^\s*\d+\s*[\.\:\-\)]+\s*/, " ");
  s = s.replace(/[“”"'`]/g, " ");
  s = s.replace(/[.,;:!?()[\]{}]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/** Token overlap: stem ngắn hơn có bao nhiêu % token nằm trong stem dài hơn. */
export function tokenOverlapRatio(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;

  const [smaller, larger] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let hit = 0;
  for (const t of smaller) {
    if (larger.has(t)) hit += 1;
  }
  return hit / smaller.size;
}
