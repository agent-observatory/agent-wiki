import { Badge } from "@/components/ui/badge";
import type { ComponentProps } from "react";

const styles: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  verifying: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  uploading: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  interrupted: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  expired: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
};

export function StatusBadge({
  status,
  ...props
}: Omit<ComponentProps<typeof Badge>, "variant" | "className"> & {
  status: string;
}) {
  return <Badge variant="secondary" className={styles[status]} {...props} />;
}
