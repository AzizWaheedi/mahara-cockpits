import type { TextareaHTMLAttributes } from "react";

export function Textarea({
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

export default Textarea;
