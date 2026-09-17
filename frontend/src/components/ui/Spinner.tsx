export function Spinner({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
      <span className="h-3 w-3 animate-pulse bg-brand" aria-hidden="true" />
      {label}
    </div>
  );
}
