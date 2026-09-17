export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border border-destructive bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
      {message}
    </div>
  );
}
