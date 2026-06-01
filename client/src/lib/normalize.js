// Name normalization used by the matching logic.
//
// Goal: make "Tom Cox", "tom  cox", and "Tom Cox." compare equal so that small
// cosmetic differences in Zoom display names don't break rate matching.

export function normalizeName(name) {
  if (name == null) return '';
  return String(name)
    .normalize('NFKD') // decompose accents into base char + combining marks
    .replace(/[̀-ͯ]/g, '') // strip the combining accent marks
    .toLowerCase()
    .replace(/[.,'"`’()[\]{}!?;:]/g, '') // remove common punctuation
    .replace(/\s+/g, ' ') // collapse internal whitespace
    .trim();
}
