import { type L, type Lang, t } from "../content";
import { Logo } from "../platforms";
import { ClientMark, type Identity } from "./Identity";

/**
 * The client's WhatsApp group as a diagram (DESIGN 7.9): a deck panel with
 * their avatar, the real WhatsApp mark and one row per role, saying what
 * that person messages them about. Not WhatsApp's own screen (WhatsApp
 * never lists roles), so no app colours, no fake messages, no tag. Roles,
 * not names: the presenting CSM is named on the cover alone.
 */
export function WhatsAppGroup({
  who,
  lang,
  header,
  rows,
}: {
  who: Identity;
  lang: Lang;
  header: L;
  rows: { key: string; name: L; line: L }[];
}) {
  return (
    <section className="dkc-group" aria-label={t(header, lang)}>
      <div className="dkc-group-head">
        <ClientMark who={who} size={56} />
        <Logo mark="whatsapp" size={34} />
        <b>{t(header, lang)}</b>
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
