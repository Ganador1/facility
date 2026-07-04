import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ProviderBaseUrlValidationOptions = {
  allowLocalhostHttp?: boolean;
  resolveHost?: (host: string) => Promise<string[]>;
};

export async function validateProviderBaseUrl(
  value: string,
  options: ProviderBaseUrlValidationOptions = {},
): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("provider_base_url_invalid");
  }

  const host = url.hostname.toLowerCase();
  const localDevHttp =
    options.allowLocalhostHttp === true && url.protocol === "http:" && isLocalhostName(host);

  if (url.username || url.password || url.hash) throw new Error("provider_base_url_invalid");
  if (url.protocol !== "https:" && !localDevHttp)
    throw new Error("provider_base_url_https_required");
  if (!standardPort(url, localDevHttp)) throw new Error("provider_base_url_port_forbidden");

  const addresses = isIP(host)
    ? [host]
    : await (options.resolveHost ?? resolveHostAddresses)(host).catch(() => {
        throw new Error("provider_base_url_unresolvable");
      });
  if (addresses.length === 0) throw new Error("provider_base_url_unresolvable");
  for (const address of addresses) {
    if (isForbiddenAddress(address) && !localDevHttp) {
      throw new Error("provider_base_url_private_host");
    }
  }
  return url.toString().replace(/\/$/, "");
}

export function isForbiddenProviderAddress(address: string): boolean {
  return isForbiddenAddress(address);
}

async function resolveHostAddresses(host: string) {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

function standardPort(url: URL, localDevHttp: boolean) {
  if (localDevHttp) return true;
  if (!url.port) return true;
  if (url.protocol === "https:") return url.port === "443";
  if (url.protocol === "http:") return url.port === "80";
  return false;
}

function isLocalhostName(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isForbiddenAddress(address: string) {
  if (isIP(address) === 4) return isForbiddenIpv4(address);
  if (isIP(address) === 6) return isForbiddenIpv6(address);
  return true;
}

function isForbiddenIpv4(address: string) {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;
  const [a = 0, b = 0] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isForbiddenIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) {
    return isForbiddenIpv4(normalized.slice("::ffff:".length));
  }
  return false;
}
