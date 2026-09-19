import { Link } from 'react-router-dom';

// Header comum a todas as telas públicas (homepage, hub do evento, provas,
// baterias, placar). O link "Área do organizador" é de propósito discreto —
// ver decisão em App.tsx sobre esconder o login da tela inicial: ele continua
// existindo e funcionando normalmente em /login, só não é mais a primeira
// coisa que aparece nem fica em destaque.
export function PublicHeader({
  subtitle,
  liveBadge = false,
}: {
  subtitle?: string;
  liveBadge?: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-5">
      <div>
        <Link to="/" className="inline-block">
          <img src="/logo-horizontal.png" alt="ScoreUp" className="h-8 w-auto" />
        </Link>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {liveBadge && (
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />
            Ao vivo
          </span>
        )}
        <Link
          to="/login"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Área do organizador
        </Link>
      </div>
    </header>
  );
}
