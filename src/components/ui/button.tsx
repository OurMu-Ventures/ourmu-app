import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-transparent px-4 text-sm font-bold transition-colors focus-visible:outline-[3px] focus-visible:outline-[rgba(215,167,71,0.45)] focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "bg-[var(--gold)] text-[var(--ink)] hover:bg-[#e3b759]",
        secondary:
          "border-[var(--ink)] bg-transparent text-[var(--ink)] hover:bg-[#ebe6d9]",
        danger: "bg-[var(--danger)] text-white hover:brightness-110",
        ghost: "text-[var(--ink)] hover:bg-[#ebe6d9]",
      },
      size: {
        default: "min-h-11 px-4",
        lg: "min-h-12 px-6 text-base",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
