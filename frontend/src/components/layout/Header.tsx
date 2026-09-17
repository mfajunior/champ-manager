import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-xs font-bold uppercase tracking-widest transition-colors ${
    isActive ? 'text-brand' : 'text-muted-foreground hover:text-foreground'
  }`;

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 flex h-20 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur">
      <Link to="/" className="font-display text-2xl uppercase tracking-wide">
        Champy
      </Link>

      <nav className="flex items-center gap-6">
        <NavLink to="/" end className={navLinkClass}>
          Campeonatos
        </NavLink>
        {user && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {user.name}
          </span>
        )}
        <button
          onClick={logout}
          className="border border-border px-3 py-2 text-xs font-bold uppercase tracking-widest text-foreground hover:bg-muted"
        >
          Sair
        </button>
      </nav>
    </header>
  );
}
