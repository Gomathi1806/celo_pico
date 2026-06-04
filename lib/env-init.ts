// lib/env-init.ts
// This file must be imported before any other lib that reads process.env at import time.

if (typeof process !== 'undefined') {
  const keyId = (process.env.CDP_API_KEY_ID || process.env.cdp_api_key_id || "").trim();
  const rawSecret = (process.env.CDP_API_KEY_SECRET || process.env.cdp_api_key_secret || "").trim();
  const secretB64 = (process.env.CDP_API_KEY_SECRET_B64 || "").trim();

  let resolvedSecret = "";

  // 1. Try Base64
  if (secretB64) {
    try {
      resolvedSecret = Buffer.from(secretB64, "base64").toString("utf8").trim();
    } catch (e) {}
  }

  // 2. Try raw secret
  if (!resolvedSecret && rawSecret) {
    if (rawSecret.startsWith("{")) {
      try {
        const parsed = JSON.parse(rawSecret);
        process.env.CDP_API_KEY_ID = (parsed.name || parsed.apiKeyId || keyId).trim();
        resolvedSecret = (parsed.privateKey || parsed.apiKeySecret || "").trim();
      } catch (e) {}
    } else {
      resolvedSecret = rawSecret.replace(/\\n/g, "\n");
    }
  }

  // 3. Final normalization for any path
  if (resolvedSecret) {
    // Standardize newlines
    resolvedSecret = resolvedSecret.replace(/\\n/g, "\n");
    
    // Ensure it has the headers if they are missing and it looks like a PEM key (contains newlines or is long)
    if (!resolvedSecret.includes("-----BEGIN") && (resolvedSecret.includes("\n") || resolvedSecret.length > 100)) {
       resolvedSecret = `-----BEGIN EC PRIVATE KEY-----\n${resolvedSecret}\n-----END EC PRIVATE KEY-----`;
    }

    process.env.CDP_API_KEY_SECRET = resolvedSecret;
  }
}
