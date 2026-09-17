export function WarningBanner({ message }: { message: string }) {
  return (
    <div className="border border-secondary bg-muted px-4 py-3 text-sm font-medium text-secondary">
      {message}
    </div>
  );
}
