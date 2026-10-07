/**
 * Search, for the search box (Ctrl/Cmd + K) and every list that filters by
 * name (Aziz, 2026-10-06: "a really good search feature").
 *
 * Forgiving on purpose: Arabic letter forms count as one letter (أ إ آ and
 * ا, ة and ه, ى and ي), case and accents are ignored, every typed word must
 * appear somewhere, and a word of five letters or more may carry one typo,
 * so "acturus" still finds Arcturus.
 */

/** One spelling for comparing: lower case, no accents, Arabic letters folded. */
export function fold(text: string): string {
  return (
    String(text ?? "")
      .normalize("NFKD")
      // Latin accents, Arabic short vowels, the hamza marks NFKD splits off, tatweel.
      .replace(/[̀-ًͯ-ٰٟـ]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** The words in a text, letters and digits only, folded. */
export function words(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** True when two words are the same but for one letter added, dropped or changed. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** A typed word that is a near miss for one of the text's words, or its start. */
function nearMiss(typed: string, inText: string[]): boolean {
  if (typed.length < 5) return false;
  return inText.some(
    w =>
      oneEditApart(typed, w) ||
      (w.length > typed.length &&
        oneEditApart(typed, w.slice(0, typed.length))),
  );
}

/**
 * How well a text answers what was typed: 0 is no match, 1 the best.
 * A match at the start of the text, or at the start of its words, ranks
 * above one in the middle of a word; a near miss ranks last.
 */
export function matchScore(text: string, typed: string): number {
  const q = fold(typed);
  if (!q) return 1;
  const h = fold(text);
  if (h.startsWith(q)) return 1;
  const asked = q.split(" ").filter(Boolean);
  const inText = words(h);
  let near = false;
  let starts = 0;
  for (const w of asked) {
    if (h.includes(w)) {
      if (inText.some(t => t.startsWith(w))) starts++;
      continue;
    }
    if (nearMiss(w, inText)) {
      near = true;
      continue;
    }
    return 0;
  }
  if (near) return 0.3;
  return 0.5 + 0.4 * (starts / asked.length);
}

/** Words that name a kind of business, not one business. */
const GENERIC = new Set(
  [
    "mahara",
    "maharamedia",
    "media",
    "whatsapp",
    "group",
    "company",
    "co",
    "the",
    "and",
    "of",
    "for",
    "construction",
    "contracting",
    "contractors",
    "consultant",
    "consultants",
    "consulting",
    "consultancy",
    "engineering",
    "engineers",
    "design",
    "designs",
    "interior",
    "interiors",
    "studio",
    "home",
    "homes",
    "projects",
    "systems",
    "industries",
    "limited",
    "ltd",
    "llc",
    "general",
    "trading",
    "services",
    "buildings",
    "finishing",
    "مهاره",
    "شركه",
    "مؤسسه",
    "للمقاولات",
    "المقاولات",
    "مقاولات",
    "للاستشارات",
    "الاستشارات",
    "الهندسيه",
    "هندسيه",
    "للتصميم",
    "المحدوده",
    "مجموعه",
  ].map(fold),
);

/** The words that pick out one client: no generic words, three letters or more. */
function telling(name: string): string[] {
  return words(name).filter(w => w.length >= 3 && !GENERIC.has(w));
}

/**
 * A test for "is this conversation one of our clients'": its name holds one
 * of a client's telling words, allowing one typo in a long word (the group
 * "Mahara | Acturus Construction" is Arcturus Construction's). Used to put
 * client groups first, never to hide anything.
 */
export function clientMatcher(
  clientNames: string[],
): (name: string) => boolean {
  const keys = [...new Set(clientNames.flatMap(telling))];
  return (name: string) => {
    const inName = telling(name);
    return inName.some(w =>
      keys.some(k => k === w || (k.length >= 5 && oneEditApart(k, w))),
    );
  };
}

/** Open the search box from anywhere: a button, a link, a keyboard key. */
const OPEN_EVENT = "cockpit:open-search";

export function openSearch(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onOpenSearch(listener: () => void): () => void {
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}
