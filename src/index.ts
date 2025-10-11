export interface Env {
  PROXY_DOMAIN?: string;
  CACHE_PURGE_KEY?: string;
  ALLOWED_ORIGINS?: string; // csv of allowed origins for CORS
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    console.log(`Proxying request to: ${url.pathname}${url.search}`);

    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect('https://github.com/carolyn-sun/google-fonts-proxy-worker', 302);
    }

    // 访问控制检查
    const allowedOrigins = env.ALLOWED_ORIGINS;
    if (allowedOrigins) {
      const referer = request.headers.get('Referer');
      const origin = request.headers.get('Origin');

      const requestOrigin = origin || (referer ? new URL(referer).origin : null);
      
      if (requestOrigin) {
        const allowedList = allowedOrigins.split(',').map(domain => domain.trim());
        const isAllowed = allowedList.some(allowedDomain => {
          return requestOrigin === `https://${allowedDomain}` || 
                 requestOrigin === `http://${allowedDomain}` ||
                 requestOrigin.endsWith(`.${allowedDomain}`);
        });
        
        if (!isAllowed) {
          console.log(`Access denied for origin: ${requestOrigin}`);
          return new Response('Access denied', { 
            status: 403,
            headers: {
              'Content-Type': 'text/plain'
            }
          });
        }
      } else {
        console.log('Access denied: No referer or origin header');
        return new Response('Access denied: Direct access not allowed', { 
          status: 403,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      }
    }

    if (url.pathname === '/purge-cache') {
      const providedKey = url.searchParams.get('key');
      const requiredKey = env.CACHE_PURGE_KEY;
      
      if (requiredKey && providedKey !== requiredKey) {
        return new Response('Unauthorized', { status: 401 });
      }
      
      const cache = caches.default;
      const targetUrl = url.searchParams.get('url');
      
      if (targetUrl) {
        await cache.delete(targetUrl);
        return new Response(`Cache cleared for: ${targetUrl}`);
      } else {
        const purgePromises = [];
        const commonUrls = [
          '/css',
          '/css2',
          '/s/'
        ];
        
        for (const path of commonUrls) {
          const cacheKey = new URL(path, url.origin).toString();
          purgePromises.push(cache.delete(cacheKey));
        }
        
        await Promise.all(purgePromises);
        return new Response('Common cache entries cleared');
      }
    }

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
          // 只对 CSS 文件进行文本处理
          try {
            const arrayBuffer = await response.arrayBuffer();
            const cssText = new TextDecoder().decode(arrayBuffer);
            console.log(`Original CSS snippet: ${cssText.substring(0, 200)}...`);

            const proxyDomain = env.PROXY_DOMAIN || url.host;
            const proxyUrl = `https://${proxyDomain}`;

            let modifiedCss = cssText
              .replace(/url\(['"]https:\/\/fonts\.gstatic\.com\//g, `url('${proxyUrl}/`)
              .replace(/url\(['"]https:\/\/fonts\.googleapis\.com\//g, `url('${proxyUrl}/`)
              .replace(/url\(https:\/\/fonts\.gstatic\.com\//g, `url(${proxyUrl}/`)
              .replace(/url\(https:\/\/fonts\.googleapis\.com\//g, `url(${proxyUrl}/`)
              .replace(/https:\/\/fonts\.gstatic\.com\//g, `${proxyUrl}/`)
              .replace(/https:\/\/fonts\.googleapis\.com\//g, `${proxyUrl}/`);

            console.log(`Modified CSS snippet: ${modifiedCss.substring(0, 200)}...`);
            console.log(`Using proxy domain: ${proxyDomain}`);

            proxyResponse = new Response(modifiedCss, response);
            proxyResponse.headers.set('Content-Type', 'text/css');
          } catch (modError: unknown) {
            console.error(`CSS modification error: ${(modError as Error).message}`);
            proxyResponse = new Response(response.body, response);
          }
        } else {
          proxyResponse = new Response(response.body, response);
          
          const contentType = response.headers.get('Content-Type');
          if (contentType) {
            proxyResponse.headers.set('Content-Type', contentType);
          }
        }

        proxyResponse.headers.set('Cache-Control', 'public, max-age=315360');
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
