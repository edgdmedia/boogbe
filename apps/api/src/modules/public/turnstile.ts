export const TURNSTILE_VERIFIER = Symbol('TURNSTILE_VERIFIER');

/**
 * `hostname`: the site the challenge was solved on, so a token from another site can be refused. `testKey`: the
 * secret is one of Cloudflare's published dummy secrets (accept only the dummy token), whose hostname means nothing.
 */
export interface TurnstileVerifier {
  verify(token: string, ip: string | undefined): Promise<{ success: boolean; hostname?: string; testKey?: true }>;
}

/** Cloudflare's dummy secrets for local and staging testing (developers.cloudflare.com/turnstile/troubleshooting/testing). */
export const isTestSecret = (secret: string) => /^[123]x0{30,}AA$/.test(secret);

/**
 * Cloudflare Turnstile server-side check. Fails closed: with no secret configured, or if Cloudflare can't be
 * reached, every request is refused with VERIFICATION_FAILED rather than let through unverified.
 */
export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(private readonly secret: string | undefined) {}

  async verify(token: string, ip: string | undefined): Promise<{ success: boolean; hostname?: string; testKey?: true }> {
    if (!this.secret) return { success: false };
    const form = new URLSearchParams({ secret: this.secret, response: token, ...(ip && { remoteip: ip }) });
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(5000),
      });
      const body = (await r.json()) as { success?: boolean; hostname?: string };
      return { success: body.success === true, hostname: body.hostname, ...(isTestSecret(this.secret) && { testKey: true as const }) };
    } catch {
      return { success: false };
    }
  }
}
