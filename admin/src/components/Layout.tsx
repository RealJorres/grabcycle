import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/authContext';
import { requireFirebase } from '../lib/firebase';
import { NAV } from './nav';
import { Button } from './ui';

export function Layout() {
  const { user, role, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const emulators = requireFirebase().emulators;
  const items = NAV.filter((n) => n.permission == null || can(n.permission));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <span className="font-semibold">GrabCycle Ops</span>
        <Button variant="secondary" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}>
          Menu
        </Button>
      </header>
      <aside id="sidebar" className={`${open ? 'block' : 'hidden'} border-r border-line bg-surface lg:block`}>
        <div className="flex h-full flex-col gap-6 p-4 lg:sticky lg:top-0 lg:h-dvh">
          <div className="hidden items-center gap-2 lg:flex">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="font-semibold">GrabCycle Ops</span>
          </div>
          {emulators && <p className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Local emulators — not production</p>}
          <nav aria-label="Main" className="flex flex-col gap-1">
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-canvas'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto border-t border-line pt-4 text-sm">
            <p className="truncate font-medium" title={user?.email ?? ''}>
              {user?.email}
            </p>
            <p className="text-muted capitalize">{role}</p>
            <Button variant="ghost" className="mt-2 -ml-3" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>
      <main id="main" className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
