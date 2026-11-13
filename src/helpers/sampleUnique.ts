import type { Question } from "../@types/question";
import { shuffleCopy } from "./shuffle";

/**
 * Sample n câu unique theo id (Set). n đã được clamp = min(requested, bank.length).
 */
export function sampleUniqueQuestions(
  bank: Question[],
  n: number,
): Question[] {
  const byId = new Map<string, Question>();
  for (const q of bank) {
    if (!byId.has(q.id)) byId.set(q.id, q);
  }
  const unique = [...byId.values()];
  const take = Math.min(n, unique.length);
  return shuffleCopy(unique).slice(0, take);
}

export function sampleByIds(
  bank: Question[],
  ids: string[],
): Question[] {
  const byId = new Map(bank.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const q = byId.get(id);
    if (q) {
      seen.add(id);
      out.push(q);
    }
  }
  return out;
}
