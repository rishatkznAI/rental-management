const RAILWAY_ORIGIN = 'https://rental-management-production-35bc.up.railway.app';

export function createUpstreamRequest(request) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${incomingUrl.pathname}${incomingUrl.search}`,
    RAILWAY_ORIGIN,
  );

  return new Request(upstreamUrl, request);
}

export default {
  fetch(request) {
    return fetch(createUpstreamRequest(request));
  },
};
