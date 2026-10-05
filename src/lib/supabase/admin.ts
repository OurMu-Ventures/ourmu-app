import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { getServerEnv } from "@/lib/env";

export function createAdminClient(signal?: AbortSignal) {
  const env = getServerEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      ...(signal
        ? {
            global: {
              fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                signal.throwIfAborted();
                const response = await fetch(input, {
                  ...init,
                  signal: init?.signal
                    ? AbortSignal.any([signal, init.signal])
                    : signal,
                });
                signal.throwIfAborted();
                return response;
              },
            },
          }
        : {}),
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
