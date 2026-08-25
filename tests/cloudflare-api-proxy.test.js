import assert from 'node:assert/strict';
import test from 'node:test';

import { createUpstreamRequest } from '../infrastructure/cloudflare-api-proxy/src/index.js';

test('Cloudflare API proxy preserves the path, query, method, and request headers', () => {
  const request = new Request('https://api.skytech-rent.ru/api/auth/login?source=web', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      origin: 'https://skytech-rent.ru',
    },
    body: JSON.stringify({ login: 'test@example.com' }),
  });

  const upstreamRequest = createUpstreamRequest(request);

  assert.equal(
    upstreamRequest.url,
    'https://rental-management-production-35bc.up.railway.app/api/auth/login?source=web',
  );
  assert.equal(upstreamRequest.method, 'POST');
  assert.equal(upstreamRequest.headers.get('authorization'), 'Bearer test-token');
  assert.equal(upstreamRequest.headers.get('origin'), 'https://skytech-rent.ru');
});
