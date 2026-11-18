import { hash, verify } from '@node-rs/argon2';

export const ARGON_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  algorithm: 2 as const,
};

export function hashPassword(password: string) {
  return hash(password, ARGON_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}
