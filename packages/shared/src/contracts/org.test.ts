import { describe, expect, it } from 'vitest';
import { UpdateOrgSettingsInput } from './org';

const origins = (o: string[]) => UpdateOrgSettingsInput.safeParse({ publicOrigins: o });

describe('online booking settings contract [WB]', () => {
  it('stores bare https origins', () => {
    const r = UpdateOrgSettingsInput.parse({ publicOrigins: ['https://tanuhomes.com/short-lets?x=1', 'https://www.tanuhomes.com'] });
    expect(r.publicOrigins).toEqual(['https://tanuhomes.com', 'https://www.tanuhomes.com']);
  });

  it('allows http only for localhost (development)', () => {
    expect(UpdateOrgSettingsInput.parse({ publicOrigins: ['http://localhost:4321'] }).publicOrigins).toEqual(['http://localhost:4321']);
    expect(origins(['http://tanuhomes.com']).success).toBe(false);
  });

  it('refuses schemes whose origin is "null" — CORS would then trust sandboxed iframes and file:// pages', () => {
    for (const bad of ['data:text/html,hi', 'javascript:alert(1)', 'file:///etc/passwd', 'null']) expect(origins([bad]).success, bad).toBe(false);
  });
});
