import type { ButtonHTMLAttributes } from "react";

/**
 * The shadcn Button's shape without shadcn.
 *
 * The other three cockpits carry the whole component library; this one has
 * five dependencies and is meant to keep them. The ideation page is the same
 * file in all four, so what it imports has to exist here -- and it uses one
 * variant and one size, which is a stylesheet, not a library.
 *
 * `buttonClass` is the same look for a link that should read as a button.
 */
type Variant = "default" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border bg-transparent hover:bg-muted",
  ghost: "bg-transparent hover:bg-muted",
  destructive: "bg-destructive text-white hover:opacity-90",
};

// The text size lives with the size, not in the base, so two font sizes
// never fight over one button (there is no class merger here).
const SIZE: Record<Size, string> = {
  default: "h-9 px-4 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-10 px-6 text-sm",
  icon: "size-9",
};

export function buttonClass({
  variant = "default",
  size = "default",
  className = "",
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}): string {
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 ${VARIANT[variant]} ${SIZE[size]} ${className}`;
}

export function Button({
  variant = "default",
  size = "default",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      type={
        type === "submit" ? "submit" : type === "reset" ? "reset" : "button"
      }
      className={buttonClass({ variant, size, className })}
      {...rest}
    />
  );
}

export default Button;
