export function AppIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <img
      src="/icons/app-icon-gorilla-192.png"
      alt=""
      aria-hidden="true"
      className={`shrink-0 object-cover ${className}`}
    />
  );
}
