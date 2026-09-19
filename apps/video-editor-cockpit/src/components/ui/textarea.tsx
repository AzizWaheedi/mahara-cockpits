import type { TextareaHTMLAttributes } from "react";

export function Textarea({
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-y rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm placeholder:text-[color:var(--muted-foreground)] disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

export default Textarea;
