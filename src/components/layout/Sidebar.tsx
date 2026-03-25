import { NavLink } from "react-router-dom";
import {
  FolderTree,
  Network,
  FlaskConical,
  Shield,
  Brain,
} from "lucide-react";
import { clsx } from "clsx";

const navItems = [
  { to: "/", icon: FolderTree, label: "Explorer" },
  { to: "/graph", icon: Network, label: "Graph" },
  { to: "/simulation", icon: FlaskConical, label: "Simulation" },
  { to: "/governance", icon: Shield, label: "Governance" },
];

export function Sidebar() {
  return (
    <aside className="flex w-52 flex-col border-r border-zinc-800 bg-zinc-950 p-3 gap-1.5">
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600">
          <Brain className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-100">AI Context OS</p>
          <p className="text-[10px] text-zinc-500">Control Panel</p>
        </div>
      </div>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
              isActive
                ? "bg-zinc-800 text-violet-300"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
            )
          }
          title={item.label}
        >
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </aside>
  );
}
