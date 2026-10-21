// The device key and the client IP are stored only as hashes. A device key is
// random, so a plain hash cannot be reversed; the IPv4 space can be enumerated
// in minutes, so an IP is hashed with a server secret.
import { createHash, createHmac } from "node:crypto";

export const hashDevice = (key: string): string => createHash("sha256").update(`device:${key}`).digest("hex");
export const hashIp = (ip: string, secret: string): string => createHmac("sha256", secret).update(ip).digest("hex");
