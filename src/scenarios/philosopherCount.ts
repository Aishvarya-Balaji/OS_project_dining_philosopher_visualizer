/**
 * Shared philosopher-count constants and wording helpers used by the UI and scenario
 * descriptions. Kept separate from App.tsx so panels can import them without cycles.
 */

export const MIN_PHILOSOPHERS = 3;
export const MAX_PHILOSOPHERS = 8;
export const DEFAULT_PHILOSOPHERS = 5;

const NUMBER_WORDS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** Lower-case English word for small counts ("five"), falling back to digits. */
export function countToWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/** Compact ordinal ("1st", "2nd", "3rd", "5th", "11th"). */
export function toOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
