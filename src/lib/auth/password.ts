import bcrypt from "bcryptjs";

// Cost 12: ~250ms per hash on typical hardware. High enough to matter, low
// enough that login stays responsive (NF-02).
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
