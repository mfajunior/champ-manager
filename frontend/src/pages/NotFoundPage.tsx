import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <h1 className="font-display text-5xl uppercase">404</h1>
      <p className="text-muted-foreground">Essa página não existe.</p>
      <Link to="/" className="text-sm font-bold uppercase tracking-wider text-brand">
        Voltar para o início
      </Link>
    </div>
  );
}
