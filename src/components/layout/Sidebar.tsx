import React from "react";
import { NavLink } from "react-router-dom";
import {
  FolderTree,
  Network,
  FlaskConical,
  Shield,
  Brain,
  BookOpen,
  ListTodo,
  Activity,
  Plug,
  Settings,
} from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import { useGovernanceBadge } from "../../lib/useGovernanceBadge";

type SidebarKey = "explorer" | "journal" | "tasks" | "graph" | "simulation" | "governance" | "observability" | "connectors";

const navItems: { to: string; icon: React.ElementType; key: SidebarKey }[] = [
  { to: "/", icon: FolderTree, key: "explorer" },
  { to: "/journal", icon: BookOpen, key: "journal" },
  { to: "/tasks", icon: ListTodo, key: "tasks" },
  { to: "/graph", icon: Network, key: "graph" },
  { to: "/simulation", icon: FlaskConical, key: "simulation" },
  { to: "/governance", icon: Shield, key: "governance" },
  { to: "/observability", icon: Activity, key: "observability" },
  { to: "/connectors", icon: Plug, key: "connectors" },
];

export function Sidebar() {
  const { t } = useTranslation();
  const governanceCount = useGovernanceBadge();
  return (
    <aside className="flex w-12 flex-col items-center border-r border-[var(--border)] bg-[color:var(--bg-0)] py-3">
      <div className="mb-4">
        <Brain className="h-5 w-5 text-[color:var(--accent)]" />
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map((item) => (
          <div key={item.to} className="group relative flex justify-center w-full">
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  isActive
                    ? "bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
                    : "text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]",
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.key === "governance" && governanceCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[color:var(--danger)] px-0.5 font-mono text-[8px] font-bold leading-none text-white">
                  {governanceCount > 99 ? "99+" : governanceCount}
                </span>
              )}
            </NavLink>
            <div className="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 scale-95 whitespace-nowrap rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2.5 py-1 text-xs font-medium text-[color:var(--text-0)] opacity-0 shadow-sm transition-all duration-100 group-hover:scale-100 group-hover:opacity-100">
              {t(`sidebar.${item.key}`)}
            </div>
          </div>
        ))}
      </nav>

      <div className="group relative mt-auto mb-4 flex w-full flex-col items-center">
        <NavLink
            to="/settings"
            className={({ isActive }) =>
              clsx(
                "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "bg-[color:var(--accent-muted)] text-[color:var(--accent)]"
                  : "text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]",
              )
            }
        >
          <Settings className="h-[18px] w-[18px]" />
        </NavLink>
        <div className="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 scale-95 whitespace-nowrap rounded-md border border-[color:var(--border)] bg-[color:var(--bg-1)] px-2.5 py-1 text-xs font-medium text-[color:var(--text-0)] opacity-0 shadow-sm transition-all duration-100 group-hover:scale-100 group-hover:opacity-100">
          {t("sidebar.settings")}
        </div>
      </div>
    </aside>
  );
}
