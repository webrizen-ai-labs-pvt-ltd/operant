import { Avatar as AvatarPrimitive, Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../cn.ts";
import { filledColors } from "../untitled/components/base/badges/badges.tsx";
import { fieldClass } from "./forms.tsx";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 rounded-xl border border-secondary bg-primary shadow-xs", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-9 px-3", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-secondary", className)} {...props} />;
}

/* Our tones mapped onto Untitled UI badge colours. */
const TONE_TO_COLOR = {
  neutral: "gray",
  ember: "brand",
  brand: "brand",
  people: "success",
  success: "success",
  finance: "warning",
  warning: "warning",
  collab: "blue",
  info: "blue",
  danger: "error",
  purple: "purple",
} as const;

export type BadgeTone = keyof typeof TONE_TO_COLOR;

/** Untitled UI badge: tinted fill, inset ring, optional status dot. */
export function Badge({
  tone = "neutral",
  dot,
  pill,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone; dot?: boolean; pill?: boolean }) {
  const c = filledColors[TONE_TO_COLOR[tone]];
  return (
    <span
      className={cn(
        "inline-flex w-max items-center gap-1 whitespace-nowrap px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        pill ? "rounded-full" : "rounded-md",
        dot && "pl-1.5",
        c.root,
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn("size-1.5 rounded-full bg-current", c.addon)} /> : null}
      {children}
    </span>
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[11px] font-medium text-quaternary ring-1 ring-secondary ring-inset",
        className,
      )}
      {...props}
    />
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** Untitled UI avatar: soft fill, hairline contrast outline, inner highlight on photos. */
export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative inline-flex size-8 shrink-0 overflow-hidden rounded-full bg-tertiary outline-[0.5px] -outline-offset-[0.5px] outline-black/16 text-xs",
        className,
      )}
    >
      {src ? <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center font-semibold text-quaternary">{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/** Untitled UI tooltip look on a Radix tooltip (works with any trigger via asChild). */
export function Tooltip({
  content,
  description,
  children,
  side = "right",
}: {
  content: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            className="z-50 flex max-w-xs flex-col gap-1 rounded-lg bg-primary-solid px-3 py-2 shadow-lg data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in"
          >
            <span className="text-xs font-semibold text-white">{content}</span>
            {description ? <span className="text-xs font-medium text-tooltip-supporting-text">{description}</span> : null}
            <TooltipPrimitive.Arrow className="fill-bg-primary-solid" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-tertiary", className)} />;
}

/** The Operant mark, tinted with the current text color. */
export function Logo({ className, src = "/icon.svg" }: { className?: string; src?: string }) {
  return (
    <span
      role="img"
      aria-label="Operant"
      className={cn("inline-block size-7 bg-current", className)}
      style={{
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: "100%",
        WebkitMaskSize: "100%",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
