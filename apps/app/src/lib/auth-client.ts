import { createAuthClient } from 'better-auth/react';
import { adminClient, organizationClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: `${import.meta.env.VITE_API_ORIGIN || window.location.origin}`,
  basePath: '/v1/auth',
  fetchOptions: { credentials: 'include' },
  plugins: [organizationClient(), adminClient()],
});
