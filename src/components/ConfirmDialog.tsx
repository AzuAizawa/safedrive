import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  isLoading?: boolean;
  // Lets a caller gate the confirm button on something the dialog itself
  // cannot know - the typed-email check on account deletion, for instance.
  // Optional and defaults to enabled, so existing callers are unaffected.
  confirmDisabled?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  destructive = false,
  isLoading = false,
  confirmDisabled = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div className="flex min-h-full items-center justify-center">
        <Card
          className="my-4 w-full max-w-md animate-scale-in shadow-2xl sm:my-8"
          onClick={(event) => event.stopPropagation()}
        >
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <div className="max-h-[calc(100vh-4rem)] overflow-y-auto">
            {children ? <CardContent>{children}</CardContent> : <CardContent />}
          </div>
          <CardFooter className="gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onCancel}
              disabled={isLoading}
            >
              {cancelText}
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              className="flex-1"
              onClick={() => {
                void onConfirm();
              }}
              disabled={isLoading || confirmDisabled}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmText}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
