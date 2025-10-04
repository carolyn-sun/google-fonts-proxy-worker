export interface Env {}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    console.log(`Proxying request to: ${url.pathname}${url.search}`);

    let targetHost: string;
    if (url.pathname.startsWith('/css') || url.pathname.startsWith('/css2')) {
      targetHost = 'fonts.googleapis.com';
    } else {
      targetHost = 'fonts.gstatic.com';
    }

    const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

    const cache = caches.default;
    let response = await cache.match(request);

    if (response) {
      console.log('Cache hit!');
      const cachedResponse = new Response(response.body, response);
      cachedResponse.headers.set('Access-Control-Allow-Origin', '*');
      return cachedResponse;
    }

    try {
      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        redirect: 'follow'
      });

      response = await fetch(proxyRequest);

      if (response.ok) {
        let proxyResponse: Response;

        if (targetHost === 'fonts.googleapis.com') {
          try {
            const arrayBuffer = await response.arrayBuffer();
            const cssText = new TextDecoder().decode(arrayBuffer);
            console.log(`Original CSS snippet: ${cssText.substring(0, 200)}...`);

            const modifiedCss = cssText.replace(
              /https:\/\/fonts\.gstatic\.com\//g,
              '/'
            );

            console.log(`Modified CSS snippet: ${modifiedCss.substring(0, 200)}...`);

            proxyResponse = new Response(modifiedCss, response);
            proxyResponse.headers.set('Content-Type', 'text/css');
          } catch (modError: unknown) {
            console.error(`CSS modification error: ${(modError as Error).message}`);

            proxyResponse = new Response(response.body, response);
          }
        } else {
          proxyResponse = new Response(response.body, response);
        }

        proxyResponse.headers.set('Cache-Control', 'public, max-age=31536000');
        proxyResponse.headers.set('Access-Control-Allow-Origin', '*');

        ctx.waitUntil(cache.put(request, proxyResponse.clone()));

        console.log('Fetched and cached successfully');
        return proxyResponse;
      } else {
        console.log(`Google response error: ${response.status}`);
        return new Response(`Proxy failed: Google returned ${response.status}`, { status: response.status });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Fetch error: ${errorMessage}`);
      return new Response(`Proxy error: ${errorMessage}`, { status: 500 });
    }
  },
};
