import { APP_VERSION, APP_VERSION_LABEL } from "@/lib/app-version";

export function VersionTag({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label={`App version ${APP_VERSION}`}
      title={`Build ${APP_VERSION}`}
      className={`font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-muted-foreground/50 ${className}`}
    >
      {APP_VERSION_LABEL}
    </span>
  );
}
