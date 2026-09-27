import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";

const ARGON2ID_OPTIONS = {
  // Argon2id is the library default; verified by the PHC-prefix test.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password must not be empty");
  return hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) return false;
  try {
    return await verify(storedHash, password, ARGON2ID_OPTIONS);
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
}
