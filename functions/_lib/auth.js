const COOKIE_NAME = "kenneth_admin";

function base64UrlEncode(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(value)
    )
  );
}

async function secureEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(left))),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(right)))
  ]);

  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}

function parseCookies(request) {
  const result = {};
  const cookieHeader = request.headers.get("Cookie") || "";

  cookieHeader.split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    result[key] = value;
  });

  return result;
}

export async function verifyPassword(input, expected) {
  return secureEqual(input || "", expected || "");
}

export async function createSessionToken(secret, ttlSeconds = 1800) {
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured.");
  }

  const payload = {
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: crypto.randomUUID()
  };

  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signature = base64UrlEncode(await hmac(encodedPayload, secret));

  return `${encodedPayload}.${signature}`;
}

export async function verifySession(request, secret) {
  if (!secret) return false;

  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return false;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return false;

  const expectedSignature = await hmac(encodedPayload, secret);
  const actualSignature = base64UrlDecode(signature);

  if (actualSignature.length !== expectedSignature.length) return false;

  let difference = 0;
  for (let index = 0; index < actualSignature.length; index += 1) {
    difference |= actualSignature[index] ^ expectedSignature[index];
  }

  if (difference !== 0) return false;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedPayload))
    );

    return Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function createSessionCookie(token, maxAge = 1800) {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}
