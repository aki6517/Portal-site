import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies();
  const safeSetCookie = (
    name: string,
    value: string,
    options?: Record<string, unknown>
  ) => {
    try {
      cookieStore.set({ name, value, ...(options ?? {}) });
    } catch {
      // In Server Components, cookie mutation is not allowed.
      // Route Handlers / Server Actions can still persist auth cookies.
    }
  };

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get: (name) => cookieStore.get(name)?.value,
      set: (name, value, options) => {
        safeSetCookie(name, value, options);
      },
      remove: (name, options) => {
        safeSetCookie(name, "", options);
      },
    },
  });
};
