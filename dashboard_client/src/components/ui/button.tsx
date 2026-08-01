import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "rounded-full bg-primary text-primary-foreground shadow hover:-translate-y-px hover:shadow-md active:scale-[0.97] transition-all duration-150",
        accent: "rounded-full bg-terra text-white dark:text-[#160B08] hover:bg-[var(--terra-hover)] active:scale-[0.97] transition-all duration-150",
        destructive: "rounded-full bg-[var(--error-tint)] text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-all duration-150",
        outline:
          "rounded-full border border-border bg-card hover:bg-secondary hover:text-primary transition-all duration-150",
        secondary: "rounded-full bg-card border border-border hover:border-primary hover:text-primary transition-all duration-150",
        ghost: "rounded-md hover:bg-secondary hover:text-foreground transition-all duration-150",
        link: "text-[var(--flow)] underline-offset-4 hover:underline hover:text-[var(--teal-hover)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 !rounded-lg px-3 py-1.5 text-[13px]",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
