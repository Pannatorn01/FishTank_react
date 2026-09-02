import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "pixel-tiny group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border-2 border-(--bevel-dark) px-2 py-0.5 text-[0.7rem] whitespace-nowrap focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-(--pixel-accent-hover)",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-(--pixel-panel-hover)",
        destructive:
          "bg-(--pixel-danger) text-(--pixel-text-strong) focus-visible:ring-destructive/20 [a]:hover:bg-(--pixel-accent-hover)",
        success: "bg-(--pixel-success) text-(--pixel-dark-1) [a]:hover:opacity-90",
        warning: "bg-(--pixel-warning) text-(--pixel-dark-1) [a]:hover:opacity-90",
        info: "bg-(--pixel-info) text-(--pixel-text-strong) [a]:hover:opacity-90",
        outline:
          "border-(--bevel-dark) bg-transparent text-foreground [a]:hover:bg-muted",
        ghost:
          "border-transparent hover:bg-muted hover:text-muted-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
