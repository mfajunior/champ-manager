import { Link, useLocation } from 'react-router-dom';

/**
 * Menu lateral das telas públicas (usuário comum — torcida/atleta, sem
 * login). Fica ao lado do conteúdo em vez de dentro do header porque os 4
 * itens (Home, Provas, Leaderboard, Baterias) são navegação de primeiro
 * nível, não uma ação pontual da página como o link "Área do organizador"
 * (esse continua no header — ver PublicHeader.tsx).
 *
 * Provas/Leaderboard/Baterias são sempre de UM campeonato (rotas
 * /evento/:id/... e /placar/:id) — sem um campeonato selecionado (ex: na
 * Home, antes de escolher um) não tem pra onde esses 3 links levarem, então
 * em vez de link quebrado ou escondido, eles ficam visíveis mas desabilitados
 * (cinza, sem clique): dá pra ver que a navegação existe, mas fica claro que
 * precisa escolher um campeonato primeiro.
 */
export function Sidebar({ championshipId }: { championshipId?: number }) {
  const location = useLocation();

  const links: { label: string; to?: string; isActive: boolean }[] = [
    {
      label: 'Home',
      to: '/',
      isActive: location.pathname === '/',
    },
    {
      label: 'Provas',
      to: championshipId ? `/evento/${championshipId}/provas` : undefined,
      isActive: !!championshipId && location.pathname.startsWith(`/evento/${championshipId}/provas`),
    },
    {
      label: 'Leaderboard',
      to: championshipId ? `/placar/${championshipId}` : undefined,
      isActive: !!championshipId && location.pathname.startsWith(`/placar/${championshipId}`),
    },
    {
      label: 'Baterias',
      to: championshipId ? `/evento/${championshipId}/baterias` : undefined,
      isActive: !!championshipId && location.pathname.startsWith(`/evento/${championshipId}/baterias`),
    },
  ];

  return (
    <nav className="hidden w-44 shrink-0 border-r border-border py-8 pr-4 sm:block">
      <ul className="flex flex-col gap-1">
        {links.map((link) =>
          link.to ? (
            <li key={link.label}>
              <Link
                to={link.to}
                className={`block border-l-2 px-3 py-2 text-xs font-bold uppercase tracking-wider ${
                  link.isActive
                    ? 'border-brand text-brand'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {link.label}
              </Link>
            </li>
          ) : (
            <li key={link.label}>
              <span className="block cursor-not-allowed border-l-2 border-transparent px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground opacity-40">
                {link.label}
              </span>
            </li>
          )
        )}
      </ul>
    </nav>
  );
}
