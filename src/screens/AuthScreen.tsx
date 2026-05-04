import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function AuthScreen() {
  const { user, signIn, signUp, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    const { error } = await (mode === "signin"
      ? signIn(email, password)
      : signUp(email, password));
    setBusy(false);
    if (error) setErr(error);
    else if (mode === "signup") {
      setInfo(
        "Check your email to confirm, then sign in. (If your Supabase project has email confirmations off, you can sign in immediately.)"
      );
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-brand-50">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white p-6 rounded-2xl shadow"
      >
        <h1 className="text-2xl font-semibold text-brand-900 mb-1">
          Backyard Bird Tracker
        </h1>
        <p className="text-sm text-slate-500 mb-5">
          {mode === "signin" ? "Sign in to your account" : "Create an account"}
        </p>

        <label className="block text-sm font-medium text-slate-700">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="mt-1 mb-4 w-full border rounded-lg px-3 py-2"
        />

        <label className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="mt-1 mb-4 w-full border rounded-lg px-3 py-2"
        />

        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        {info && <p className="text-sm text-brand-700 mb-3">{info}</p>}

        <button
          disabled={busy}
          className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-3 rounded-lg disabled:opacity-60"
        >
          {busy
            ? "Working…"
            : mode === "signin"
              ? "Sign in"
              : "Sign up"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full mt-3 text-sm text-brand-700"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
