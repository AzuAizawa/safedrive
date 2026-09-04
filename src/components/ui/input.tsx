import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&::-ms-clear]:hidden [&::-ms-reveal]:hidden md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // A native file input is one clickable control end-to-end, but the
        // default look only makes the "Choose File" text read as a button -
        // the rest of the box (and the "No file chosen" text) looks inert.
        // Style the file-selector button like a real outline button and put
        // a pointer cursor on the whole control so the affordance is
        // consistent everywhere you click it.
        type === "file" &&
          "cursor-pointer file:mr-3 file:h-6 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-background file:px-2.5 file:text-foreground hover:file:bg-muted dark:file:border-input dark:file:bg-input/30 dark:hover:file:bg-input/50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
