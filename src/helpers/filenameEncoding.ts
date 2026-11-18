/**
 * Multer/busboy thường decode tên file UTF-8 như Latin-1 → mojibake
 * (vd. "Phương" thành "PhÆ°Æ¡ng"). Sửa bằng latin1 → utf8.
 */
export function decodeUploadFilename(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return raw;

  const looksMojibake =
    /PhÆ|Æ°|Æ¡|á»|Ã¡|Ã |Ã¢|Ã¨|Ã©|Ã¬|Ã²|Ã³|Ã¹|Ãº|Äá|áº|á»/.test(raw) ||
    /Ã[\u0080-\u00BF]|Æ[\u00A0-\u00BF]/.test(raw);

  if (!looksMojibake) return raw;

  try {
    const fixed = Buffer.from(raw, "latin1").toString("utf8");
    if (!fixed || fixed.includes("\uFFFD")) return raw;
    // Chỉ nhận nếu sau sửa có ký tự Việt / không còn cụm mojibake điển hình
    const stillBroken = /PhÆ|Æ°|Æ¡|á»|á» |Ã²ng/.test(fixed);
    if (stillBroken) return raw;
    return fixed;
  } catch {
    return raw;
  }
}

/** Bỏ phần mở rộng file để làm tiêu đề quiz. */
export function titleFromFilename(name: string): string {
  const decoded = decodeUploadFilename(name);
  return decoded.replace(/\.[^.]+$/, "").trim() || decoded;
}
