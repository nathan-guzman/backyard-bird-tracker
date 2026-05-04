import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session as AuthSession, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AuthCtx = {
  user: User | null;
  session: AuthSession | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    user: session?.user ?? null,
    session,
    loading,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      return { error: error?.message };
    },
    async signUp(email, password) {
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error?.message };
    },
    async signOut() {
      await supabase.auth.signOut();
    }
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
