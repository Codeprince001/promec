import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type SelectedVehicle = {
  variantId: string;
  label: string;
  year?: number;
};

type DeskState = {
  vehicle: SelectedVehicle | null;
  guestToken: string | null;
  setVehicle: (vehicle: SelectedVehicle | null) => void;
  setGuestToken: (guestToken: string | null) => void;
};

export const useDesk = create<DeskState>()(
  persist(
    (set) => ({
      vehicle: null,
      guestToken: null,
      setVehicle: (vehicle) => set({ vehicle }),
      setGuestToken: (guestToken) => set({ guestToken }),
    }),
    { name: 'promec.desk', storage: createJSONStorage(() => localStorage) },
  ),
);
