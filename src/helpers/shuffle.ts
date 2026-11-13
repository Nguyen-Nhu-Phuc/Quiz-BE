import type { Question } from "../@types/question";

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function shuffleCopy<T>(arr: readonly T[]): T[] {
  return shuffleInPlace([...arr]);
}

/** Xáo 4 choices và cập nhật correctIndex. */
export function shuffleChoices(question: Question): Question {
  const indexed = question.choices.map((text, index) => ({ text, index }));
  shuffleInPlace(indexed);
  const choices = indexed.map((c) => c.text) as [
    string,
    string,
    string,
    string,
  ];
  const correctIndex = indexed.findIndex(
    (c) => c.index === question.correctIndex,
  ) as 0 | 1 | 2 | 3;

  return {
    ...question,
    choices,
    correctIndex,
  };
}

/** Xáo thứ tự câu + xáo choices từng câu. */
export function shuffleQuestionsForSession(questions: Question[]): Question[] {
  return shuffleCopy(questions).map(shuffleChoices);
}
