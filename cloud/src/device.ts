// The device key and the client IP are stored only as hashes.
import { createHash } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const hashDevice = (key: string): string => sha256(`device:${key}`);
export const hashIp = (ip: string): string => sha256(`ip:${ip}`);
