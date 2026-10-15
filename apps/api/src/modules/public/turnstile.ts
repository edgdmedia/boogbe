export const TURNSTILE_VERIFIER = Symbol('TURNSTILE_VERIFIER');

export interface TurnstileVerifier {
  verify(token: string, ip: string | undefined): Promise<boolean>;
}

/**
 * Cloudflare Turnstile server-side check. Fails closed: with no secret configured, or if Cloudflare can't be
 * reached, every request is refused with VERIFICATION_FAILED rather than let through unverified.
 */
export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(private readonly secret: string | undefined) {}

  async verify(token: string, ip: string | undefined): Promise<boolean> {
    if (!this.secret) return false;
    const form = new URLSearchParams({ secret: this.secret, response: token, ...(ip && { remoteip: ip }) });
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(5000),
      });
      return ((await r.json()) as { success?: boolean }).success === true;
    } catch {
      return false;
    }
  }
}
