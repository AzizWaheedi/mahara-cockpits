import type { L, Lang } from "./content";

/**
 * The Drive box's words (prep's ads panel and the notes window): cockpit UI,
 * never the canvas. English and Arabic, copied from CONTENT.md and
 * CONTENT-AR.md ("The Drive link") and DRIVE-IMPORT.md 6, word for word;
 * scripts/deck-drive.test.ts reads those tables and fails on any drift.
 *
 * Kept apart from content.ts on purpose: content.ts is what the decks say
 * to the client, and its copy test refuses Latin product names and digits
 * inside Arabic lines (MP4, JPG, 150 MB) and Title Case product names
 * (Google Docs, WebP) that these sentences need, as the server stores them.
 * The prep and notes UI is English today; the Arabic is here, ready for an
 * Arabic prep, and the box takes a language for it.
 */

export const DRIVE_UI = {
  title: { en: "Bring in from Drive", ar: "جيب من الدرايف" },
  label: { en: "Paste a Drive link", ar: "الصق رابط من الدرايف" },
  hint: {
    en: "A folder, or one video or picture. The first files arrive in the tray in about a minute.",
    ar: "مجلد، أو فيديو أو صورة وحدة. أول الملفات توصل للتصاميم خلال دقيقة تقريباً.",
  },
  button: { en: "Bring in", ar: "جيب" },
  checking: { en: "Checking…", ar: "نتأكد من الرابط…" },
  started: { en: "Started", ar: "بدينا" },
  /**
   * A link left out of a paste whose other links started (the fixer's
   * round): a note under the box, not an error on the field, since the
   * paste worked.
   */
  skipped: { en: "Skipped", ar: "تركناه" },
  overTen: {
    en: "Only the first 10 links were sent. Paste the rest once these finish.",
    ar: "أرسلنا أول ١٠ روابط بس. الصق الباقي لما تخلص هذي.",
  },
  queued: {
    en: "Waiting to start. It usually starts within a minute.",
    ar: "ينتظر دوره. عادةً يبدي خلال دقيقة.",
  },
  opening: { en: "Opening the Drive link…", ar: "نفتح رابط الدرايف…" },
  file: {
    queued: { en: "Waiting", ar: "ينتظر" },
    working: { en: "Bringing in", ar: "نجيبه" },
    landed: { en: "In the tray", ar: "وصل للتصاميم" },
    skipped: { en: "Already in the tray", ar: "موجود من قبل" },
  },
  doneSome: {
    en: "Brought in {landed} of {n} files. Each one that didn't come in says why below.",
    ar: "جبنا {landed} من {n}. واللي ما وصل، مكتوب تحته السبب.",
  },
  doneNothingNew: {
    en: "Everything in this link is already in the tray.",
    ar: "كل اللي في هالرابط موجود بالتصاميم من قبل.",
  },
  overTwenty: {
    en: "Only the newest 20 came in. Paste a subfolder's link for the rest.",
    ar: "وصل أحدث ٢٠ ملف بس. وللباقي، الصق رابط مجلد من داخله.",
  },
  nobody: {
    en: "Nothing has picked this up yet. The Drive importer last ran {time}. Upload the files here for now.",
    ar: "ما بدينا فيه للحين. آخر مرة اشتغلت أداة الدرايف {time}. ارفع الملفات هنا لين ترجع تشتغل.",
  },
  stalled: {
    en: "This stopped part-way. The Drive importer last ran {time}. It carries on when it runs again; upload the files here if you need them now.",
    ar: "الاستيراد وقف بالنص. آخر مرة اشتغلت أداة الدرايف {time}. بيكمل من مكانه أول ما ترجع تشتغل، وإذا تحتاج الملفات الحين، ارفعها هنا.",
  },
  never: {
    en: "The Drive importer hasn't run yet. Upload the files here for now.",
    ar: "أداة الدرايف ما اشتغلت للحين. ارفع الملفات هنا لين تشتغل.",
  },
  readFailed: {
    en: "Couldn't check the import: {reason}. Trying again.",
    ar: "ما قدرنا نتأكد من الاستيراد: {reason}. نحاول مرة ثانية.",
  },
  /** A finished import's rows, folded to the ones that need the CSM. */
  showList: { en: "Show the list ({n})", ar: "اعرض القائمة ({n})" },
  hideList: { en: "Hide the list", ar: "سكّر القائمة" },
  /** The field's clear button, beside a refused link. */
  clear: { en: "Clear the link", ar: "امسح الرابط" },
  /**
   * The fixer's round, now in both tables: the two functions are not
   * deployed yet, so the box says so once instead of retrying a read that
   * cannot answer.
   */
  notLive: {
    en: "Bringing in from Drive isn't live yet. Upload the files here for now.",
    ar: "الاستيراد من الدرايف ما صار جاهز للحين. ارفع الملفات هنا لين يجهز.",
  },
  yesterday: { en: "yesterday", ar: "أمس" },
  /** Today's clock in English (final score round 1: "last ran 09:49"). */
  today: { en: "today", ar: "اليوم" },
} as const;

/** The request's refusals, by the HINT the server raises (DRIVE-IMPORT.md 6). */
export const DRIVE_REFUSED: Record<string, L> = {
  link_empty: {
    en: "Paste a Drive link: a folder, or one video or picture.",
    ar: "الصق رابط من الدرايف: مجلد، أو فيديو أو صورة وحدة.",
  },
  link_docs: {
    en: "That's a Google Docs link. Paste a Drive folder, or one video or picture.",
    ar: "هذا رابط مستند من Google Docs. الصق رابط مجلد بالدرايف، أو فيديو أو صورة وحدة.",
  },
  link_page: {
    en: "This link opens a Drive page, not a folder. Open the folder and copy its link.",
    ar: "هذا الرابط يفتح صفحة بالدرايف، مو مجلد. افتح المجلد وانسخ رابطه.",
  },
  link_bad: {
    en: "This isn't a Drive folder or file link.",
    ar: "هذا مو رابط مجلد أو ملف بالدرايف.",
  },
  too_many_open: {
    en: "Ten imports are already running for this client. Wait for one to finish, then paste the link again.",
    ar: "فيه ١٠ عمليات استيراد شغالة لهالعميل. انتظر وحدة تخلص، وبعدها الصق الرابط مرة ثانية.",
  },
  too_many_links: {
    en: "Too many Drive links in the last hour. Wait a few minutes, then paste it again.",
    ar: "وصلتنا روابط درايف كثيرة خلال آخر ساعة. انتظر كم دقيقة، وبعدها الصق الرابط مرة ثانية.",
  },
};

/** A failed import's sentence, by its code (not_found by the link's kind). */
export const DRIVE_FAILED = {
  not_found: {
    folder: {
      en: "We can't open this folder. Ask the client to share it as anyone with the link, or move it into their Drive folder.",
      ar: "ما نقدر نفتح هالمجلد. اطلب من العميل يشاركه مع أي شخص لديه الرابط، أو ينقله داخل مجلدهم بالدرايف.",
    },
    file: {
      en: "We can't open this file. Ask the client to share it as anyone with the link, or move it into their Drive folder.",
      ar: "ما نقدر نفتح هالملف. اطلب من العميل يشاركه مع أي شخص لديه الرابط، أو ينقله داخل مجلدهم بالدرايف.",
    },
    either: {
      en: "We can't open this link. Ask the client to share it as anyone with the link, or move it into their Drive folder.",
      ar: "ما نقدر نفتح هالرابط. اطلب من العميل يشاركه مع أي شخص لديه الرابط، أو ينقل الملف داخل مجلدهم بالدرايف.",
    },
  },
  not_media: {
    en: "That file isn't a picture or a video. Paste a folder, or one video or picture.",
    ar: "هالملف مو صورة ولا فيديو. الصق رابط مجلد، أو فيديو أو صورة وحدة.",
  },
  nothing_found: {
    en: "There are no pictures or videos in this folder, or in the folders inside it.",
    ar: "ما فيه صور ولا فيديوهات في هالمجلد، ولا في المجلدات اللي داخله.",
  },
  drive_down: {
    en: "Drive can't be reached from our side right now. Upload the files here instead.",
    ar: "ما نقدر نوصل للدرايف من عندنا الحين. ارفع الملفات هنا بدال الرابط.",
  },
  access_revoked: {
    en: "This import stopped: whoever started it can no longer open this client.",
    ar: "توقف الاستيراد: اللي بداه ما عاد يقدر يفتح هالعميل.",
  },
  stopped: {
    en: "This import stopped three times without bringing anything in. Paste the link again, or upload the files here.",
    ar: "توقف الاستيراد ثلاث مرات وما جاب شي. الصق الرابط مرة ثانية، أو ارفع الملفات هنا.",
  },
  not_started: {
    en: "This import couldn't start. Paste the link again, or upload the files here.",
    ar: "ما قدرنا نبدي بالاستيراد. الصق الرابط مرة ثانية، أو ارفع الملفات هنا.",
  },
} as const;

/** A failed file's sentence, by its code; {name} is the file's Drive name. */
export const DRIVE_FILE_FAILED = {
  too_big: {
    video: {
      en: "{name} is too long or too large to bring in. Upload a cut under 5 minutes, or send it in the group.",
      ar: "{name} طويل أو حجمه كبير، وما نقدر نجيبه. ارفع نسخة أقل من ٥ دقايق، أو أرسله بالقروب.",
    },
    image: {
      en: "{name} is over 150 MB. Export a smaller copy and upload it here.",
      ar: "{name} أكبر من ١٥٠ ميقا. صدّر نسخة أصغر وارفعها هنا.",
    },
  },
  wrong_type: {
    en: "{name} isn't a picture or a video we can show. Pictures: JPG, PNG, WebP. Videos: MP4, MOV, WebM.",
    ar: "{name} مو صورة أو فيديو نقدر نعرضه. الصور: JPG وPNG وWebP. الفيديوهات: MP4 وMOV وWebM.",
  },
  heic: {
    en: "{name} is an iPhone photo (HEIC) we couldn't convert. Export it as JPG and upload it here.",
    ar: "{name} صورة آيفون (HEIC) ما قدرنا نحولها. صدّرها JPG وارفعها هنا.",
  },
  unplayable: {
    en: "{name} couldn't be converted to play in a browser. Export it as MP4 and upload it here.",
    ar: "{name} ما قدرنا نحوله عشان يشتغل بالمتصفح. صدّره MP4 وارفعه هنا.",
  },
  download: {
    en: "{name} didn't come through from Drive. Paste the link again; files already in the tray are skipped.",
    ar: "{name} ما وصل من الدرايف. الصق الرابط مرة ثانية، واللي بالتصاميم ما يتكرر.",
  },
  storage: {
    en: "{name} didn't save. Paste the link again; files already in the tray are skipped.",
    ar: "{name} ما انحفظ. الصق الرابط مرة ثانية، واللي بالتصاميم ما يتكرر.",
  },
  unfinished: {
    en: "{name} didn't finish. Paste the link again; files already in the tray are skipped.",
    ar: "{name} ما كمل. الصق الرابط مرة ثانية، واللي بالتصاميم ما يتكرر.",
  },
  full: {
    en: "This client has 200 files already. Remove some, then paste the link again.",
    ar: "عند هالعميل ٢٠٠ ملف. شيل بعضها، وبعدها الصق الرابط مرة ثانية.",
  },
} as const;

/** A landed file's note: not a failure. */
export const DRIVE_NOTE = {
  converted: {
    en: "{name} was converted to MP4 so it plays in every browser.",
    ar: "{name} حوّلناه MP4 عشان يشتغل على كل المتصفحات.",
  },
} as const;

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** A count in the box's language: Arabic-Indic digits in Arabic. */
export const num = (n: number, lang: Lang) =>
  lang === "ar"
    ? String(n).replace(/[0-9]/g, d => AR_DIGITS[Number(d)])
    : String(n);

/** "Bringing in {n} links from Drive…": the head line with two or more open. */
export function severalLinks(n: number, lang: Lang): string {
  if (lang === "en") return `Bringing in ${n} links from Drive…`;
  return n === 2
    ? "نجيب رابطين من الدرايف…"
    : `نجيب ${num(n, "ar")} روابط من الدرايف…`;
}

/**
 * "Bringing in {n} of {total} links from Drive…": the head line when the
 * box also shows finished links under the open ones (score round 2: "3
 * links" sat over six link cards). `total` is at least 3 here.
 */
export function severalLinksOf(n: number, total: number, lang: Lang): string {
  if (lang === "en") return `Bringing in ${n} of ${total} links from Drive…`;
  const links = total <= 10 ? "روابط" : "رابط";
  return `نجيب ${num(n, "ar")} من ${num(total, "ar")} ${links} من الدرايف…`;
}

/** The Arabic number forms for files (CONTENT-AR "The Drive link"). */
function filesAr(n: number): string {
  if (n === 1) return "ملف واحد";
  if (n === 2) return "ملفين";
  if (n >= 3 && n <= 10) return `${num(n, "ar")} ملفات`;
  return `${num(n, "ar")} ملف`;
}

/** "Bringing in {n} files from Drive…" */
export function bringingFiles(n: number, lang: Lang): string {
  if (lang === "ar") return `نجيب ${filesAr(n)} من الدرايف…`;
  return n === 1
    ? "Bringing in 1 file from Drive…"
    : `Bringing in ${n} files from Drive…`;
}

/** "Brought in {n} files from Drive." */
export function broughtFiles(n: number, lang: Lang): string {
  if (lang === "ar") return `جبنا ${filesAr(n)} من الدرايف.`;
  return n === 1
    ? "Brought in 1 file from Drive."
    : `Brought in ${n} files from Drive.`;
}
