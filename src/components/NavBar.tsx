import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export default function NavBar() {
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("finalized", true)
        .is("exported_at", null);
      if (!cancelled) setPendingCount(count ?? 0);
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user]);

  const cls = ({ isActive }: { isActive: boolean }) =>
    `flex-1 py-3 text-center text-sm font-medium ${
      isActive ? "text-brand-700" : "text-slate-500"
    }`;

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 grid grid-cols-3 z-20 pb-[env(safe-area-inset-bottom)]">
      <NavLink to="/" className={cls} end>
        Count
      </NavLink>
      <NavLink to="/pending" className={cls}>
        Sessions
        {pendingCount > 0 && (
          <span className="ml-1 inline-block min-w-5 px-1 rounded-full bg-brand-600 text-white text-xs">
            {pendingCount}
          </span>
        )}
      </NavLink>
      <NavLink to="/stats" className={cls}>
        Stats
      </NavLink>
    </nav>
  );
}
