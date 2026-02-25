'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/components/auth-provider';
import { formatUserDisplayName } from '@/lib/format';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !token) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
    }
  }, [pathname, ready, router, token]);

  if (!ready) {
    return <div className="page-state">Carregando sessão...</div>;
  }

  if (!token) {
    return <div className="page-state">Redirecionando para login...</div>;
  }

  return <>{children}</>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Dashboard' },
    { href: '/items', label: 'Itens' },
    { href: '/products', label: 'Produtos' },
    { href: '/intermediate-products', label: 'Produtos intermediarios' },
    { href: '/operations', label: 'Operações' },
    { href: '/movements', label: 'Movimentações' },
    ...(user?.role === 'ADMIN' ? [{ href: '/users', label: 'Controle de usuários' }] : []),
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CE</span>
          <div>
            <p className="brand-title">Controle de Estoque</p>
            <p className="brand-subtitle">Produtos + BOM + auditoria</p>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={pathname === item.href ? 'nav-link active' : 'nav-link'}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div>
            <p className="topbar-title">{user ? formatUserDisplayName(user) : 'Usuário'}</p>
            <p className="topbar-subtitle">{user?.role ?? '-'}</p>
          </div>
          <button type="button" className="button ghost" onClick={logout}>
            Sair
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

