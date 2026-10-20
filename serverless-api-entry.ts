import app from './backend/api-server/src/app';

export default function handler(
  request: Parameters<typeof app>[0],
  response: Parameters<typeof app>[1],
): void {
  const incomingUrl = new URL(
    request.url ?? '/',
    `https://${request.headers.host ?? 'vercel.local'}`,
  );
  const apiPath = incomingUrl.searchParams.get('path');

  if (apiPath === null) {
    response.status(400).json({ error: 'The API route is missing.' });
    return;
  }

  incomingUrl.searchParams.delete('path');
  const remainingQuery = incomingUrl.searchParams.toString();
  const safePath = apiPath
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  request.url = `/api/${safePath}${remainingQuery ? `?${remainingQuery}` : ''}`;

  app(request, response);
}
