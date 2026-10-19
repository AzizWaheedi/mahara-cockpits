import { type L, type Lang, t } from "../content";
import { ClientMark, type Identity } from "./Identity";

/**
 * The client's WhatsApp group as a diagram (DESIGN 7.9): the group's head
 * (their avatar, its name and the hours as its description), then its
 * members as ruled rows, each role beside what that person messages them
 * about. Not WhatsApp's own screen (WhatsApp never lists roles), so no app
 * colours, no fake messages, no tag, and no card around it: the rows run
 * the content's width on the slide's ground. Roles, not names: the
 * presenting CSM is named on the cover alone.
 */
export function WhatsAppGroup({
  who,
  lang,
  header,
  about,
  rows,
}: {
  who: Identity;
  lang: Lang;
  header: L;
  /** The group's description line under its name (the hours). */
  about: L;
  rows: { key: string; name: L; line: L }[];
}) {
  return (
    <section className="dkc-group" aria-label={t(header, lang)}>
      <div className="dkc-group-head">
        <ClientMark who={who} size={64} />
        <div className="dkc-group-name">
          <b>{t(header, lang)}</b>
          <p>{t(about, lang)}</p>
        </div>
      </div>
      <ul className="dkc-group-rows">
        {rows.map(r => (
          <li key={r.key}>
            <span>{t(r.name, lang)}</span>
            <span>{t(r.line, lang)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
