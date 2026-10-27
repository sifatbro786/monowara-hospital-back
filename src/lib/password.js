import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12; // ~250 ms on the VPS — slow enough for offline cracking, fine for a staff login

/**
 * Staff password rule. bcrypt only uses the first 72 BYTES (a Bangla character is 3), so longer
 * input is rejected instead of being silently truncated.
 */
export const passwordSchema = z
    .string()
    .min(10, "at least 10 characters")
    .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "too long (max 72 bytes)")
    .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), "must contain a letter and a number");

export const hashPassword = (plain) => bcrypt.hash(plain, COST);

// Compared when the email doesn't exist, so "unknown user" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-0", COST);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash || DUMMY_HASH);
