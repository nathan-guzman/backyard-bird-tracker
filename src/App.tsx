import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { hasSupabaseConfig } from "./lib/supabase";
import AuthScreen from "./screens/AuthScreen";
import CounterScreen from "./screens/CounterScreen";
import PendingScreen from "./screens/PendingScreen";
import SessionDetailScreen from "./screens/SessionDetailScreen";
import StatsScreen from "./screens/StatsScreen";
import NavBar from "./components/NavBar";

function ConfigBanner() {
  if (hasSupabaseConfig) return null;
  return (
    <div className="bg-amber-100 text-amber-900 p-3 text-sm border-b border-amber-300">
      <strong>Setup needed:</strong> add <code>VITE_SUPABASE_URL</code> and{" "}
      <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code>. See{" "}
      <code>README.md</code>.
    </div>
  );
}

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-full grid place-items-center text-brand-700">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  return children;
}

function Shell({ children }: { children: JSX.Element }) {
  return (
    <div className="min-h-full flex flex-col">
      <ConfigBanner />
      <main className="flex-1 pb-20">{children}</main>
      <NavBar />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/auth" element={<AuthScreen />} />
        <Route
          path="/"
          element={
            <Protected>
              <Shell>
                <CounterScreen />
              </Shell>
            </Protected>
          }
        />
        <Route
          path="/pending"
          element={
            <Protected>
              <Shell>
                <PendingScreen />
              </Shell>
            </Protected>
          }
        />
        <Route
          path="/sessions/:id"
          element={
            <Protected>
              <Shell>
                <SessionDetailScreen />
              </Shell>
            </Protected>
          }
        />
        <Route
          path="/stats"
          element={
            <Protected>
              <Shell>
                <StatsScreen />
              </Shell>
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
