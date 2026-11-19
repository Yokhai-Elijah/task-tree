import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

/** undefined while loading, null when signed out, otherwise the Supabase session. */
export function useSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return session;
}
