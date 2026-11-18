import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type SessionState = {
  token: string | null;
  setToken: (token: string | null) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
    }),
    { name: 'promec.session', storage: createJSONStorage(() => sessionStorage) },
  ),
);

export function readToken() {
  return useSession.getState().token;
}

export function saveToken(token: string) {
  useSession.getState().setToken(token);
}

export function clearToken() {
  useSession.getState().setToken(null);
}
