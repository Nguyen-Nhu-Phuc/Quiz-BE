export const DEFAULT_N_ON_LUYEN = 15;
export const DEFAULT_N_PHONG_THI = 60;
export const DEFAULT_THOI_GIAN_PHUT = 30;
export const N_NGAN_HANG_MIN = 60;
export const N_NGAN_HANG_GOI_Y_MIN = 70;
export const N_NGAN_HANG_GOI_Y_MAX = 90;

/** Kỳ vọng tối thiểu với đề tổng hợp điển hình (EXTRACT). Thấp hơn → needsReview. */
export const EXTRACT_BANK_REVIEW_THRESHOLD = 100;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/** Chỉ PDF/DOCX (bỏ .doc cũ — mammoth kém hỗ trợ). */
export const ALLOWED_EXTENSIONS = [".pdf", ".docx"] as const;

/** Số file tối đa mỗi lần upload / mỗi lần generate quiz. */
export const MAX_UPLOAD_FILES = 10;
