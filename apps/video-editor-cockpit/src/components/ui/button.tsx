import type { ButtonHTMLAttributes } from "react";

/**
 * The shadcn Button's shape without shadcn.
 *
 * The other three cockpits carry the whole component library; this one has
 * five dependencies and is meant to keep them. The ideation page is the same
 * file in all four, so what it imports has to exist here -- and it uses one
 * variant and one size, which is a stylesheet, not a library.
 */
type Variant = "default" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  default:
    "bg-[color:var(--primary)] text-[color:var(--primary-foreground)] hover:opacity-90",
  outline: "border hairline bg-transparent hover:bg-[color:var(--secondary)]",
  ghost: "bg-transparent hover:bg-[color:var(--secondary)]",
  destructive: "bg-[color:var(--destructive)] text-white hover:opacity-90",
};

const SIZE: Record<Size, string> = {
  default: "h-9 px-4",
  sm: "h-8 px-3 text-[13px]",
  lg: "h-10 px-6",
  icon: "size-9",
};

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
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
}

export default Button;
