import type { ReactNode } from "react";

/**
 * Secondary facts in one quiet line under a tile row, each "label value",
 * so a card keeps four to six tiles and still says everything it knows.
 */
export function Facts({
  items,
}: {
  items: { label: string; value: ReactNode; hint?: string }[];
}) {
  const shown = items.filter(i => i.value !== null && i.value !== undefined);
  if (!shown.length) return null;
  return (
    <p className="ceo-facts">
      {shown.map(i => (
        <span key={i.label} title={i.hint}>
          {i.label} <strong>{i.value}</strong>
        </span>
      ))}
    </p>
  );
}
