import { toast } from "sonner";

export function report(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}
