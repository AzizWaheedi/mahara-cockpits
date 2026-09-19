import type { LabelHTMLAttributes } from "react";

/** The shadcn Label's shape: a label that always names a control. */
export function Label({
  className = "",
  htmlFor,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement> & { htmlFor: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is required above
    <label
      htmlFor={htmlFor}
      className={`block text-[13px] font-medium ${className}`}
      {...rest}
    />
  );
}

export default Label;
