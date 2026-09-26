import { ASPECTS, type Aspect } from "./media";

/**
 * Pick the post's shape the way Instagram's composer does. Each choice is
 * drawn to scale, so the four read as shapes before they read as numbers.
 */
export function ShapePicker({
  value,
  onChange,
  disabled,
}: {
  value: Aspect;
  onChange: (next: Aspect) => void;
  disabled?: boolean;
}) {
  const note = ASPECTS.find(a => a.key === value)?.note;
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Shape"
        className="flex flex-wrap gap-1.5"
      >
        {ASPECTS.map(a => {
          const on = a.key === value;
          // Every outline 16px tall and as wide as its shape: to scale.
          const w = Math.round(16 * a.ratio);
          return (
            <button
              key={a.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              title={`${a.label}, ${a.size}`}
              onClick={() => onChange(a.key)}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs disabled:opacity-50 ${
                on
                  ? "border-primary bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span
                aria-hidden
                className={`inline-block rounded-[2px] border-[1.5px] ${
                  on ? "border-primary bg-primary/15" : "border-current"
                }`}
                style={{ width: `${w}px`, height: "16px" }}
              />
              <span className="tabular-nums">{a.key}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {note ??
          `${ASPECTS.find(a => a.key === value)?.label}, ${ASPECTS.find(a => a.key === value)?.size}. Every picture in the post takes this shape.`}
      </p>
    </div>
  );
}
