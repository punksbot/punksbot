import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef } from "react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ children, className = "", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <DialogPrimitive.Content
        className={`pointer-events-auto relative grid w-[calc(100vw-2rem)] max-w-2xl gap-4 rounded-xl bg-background shadow-xl outline-hidden ${className}`}
        ref={ref}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-4 top-4 rounded-md border border-border px-2 py-1 text-sm hover:bg-accent"
        >
          Close
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </div>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "PunksDialogContent";
