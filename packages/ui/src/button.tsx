import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Variant = "primary" | "outline" | "textual" | "danger";
type Size = "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[11px]",
  md: "h-10 px-6 text-[12px]",
  lg: "h-[52px] px-10 text-[12px]",
};

function classesFor(variant: Variant, size: Size, className?: string) {
  const base =
    "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-mono uppercase tracking-[0.22em] transition-colors disabled:pointer-events-none disabled:opacity-50";
  if (variant === "textual") {
    return cx(base, "h-auto px-0 tracking-[0.18em] text-(--mut) hover:text-(--ink)", className);
  }
  if (variant === "danger") {
    return cx(
      base,
      sizes[size],
      "border border-(--bad) text-(--bad) hover:bg-(--bad) hover:text-black",
      className,
    );
  }
  if (variant === "primary") {
    return cx(base, sizes[size], "border border-(--accent) text-(--accent)", className);
  }
  return cx(
    base,
    sizes[size],
    "border border-(--line) text-(--mut) hover:border-(--accent) hover:text-(--accent)",
    className,
  );
}

/** Primary buttons carry the sliding accent fill — text flips to black on hover. */
function Fill({ variant }: { variant: Variant }) {
  if (variant !== "primary") return null;
  return (
    <span
      aria-hidden
      className="absolute inset-0 origin-left scale-x-0 bg-(--accent) transition-transform duration-300 group-hover:scale-x-100"
    />
  );
}

function Label({ variant, children }: { variant: Variant; children: ReactNode }) {
  return (
    <span
      className={cx(
        "relative z-10 inline-flex items-center gap-2 transition-colors",
        variant === "primary" && "group-hover:text-black",
      )}
    >
      {children}
      {variant === "textual" ? <span aria-hidden>→</span> : null}
    </span>
  );
}

export function Button({
  variant = "outline",
  size = "md",
  className,
  children,
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button type={type ?? "button"} className={classesFor(variant, size, className)} {...props}>
      <Fill variant={variant} />
      <Label variant={variant}>{children}</Label>
    </button>
  );
}

export function ButtonLink({
  variant = "outline",
  size = "md",
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return (
    <a className={classesFor(variant, size, className)} {...props}>
      <Fill variant={variant} />
      <Label variant={variant}>{children}</Label>
    </a>
  );
}
