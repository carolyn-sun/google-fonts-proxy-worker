export interface Env {
  PROXY_DOMAIN?: string;
  CACHE_PURGE_KEY?: string;
  ALLOWED_ORIGINS?: string; // csv of allowed origins for CORS
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect('https://github.com/carolyn-sun/google-fonts-proxy-worker', 302);
    }

    // --- 1. 安全性与严密性: CORS 严格校验 ---
    const allowedOrigins = env.ALLOWED_ORIGINS;
    if (allowedOrigins) {
      const referer = request.headers.get('Referer');
      const origin = request.headers.get('Origin');

      const requestOrigin = origin || (referer ? new URL(referer).origin : null);

      if (requestOrigin) {
        // Support domains with or without protocol by cleaning them up
        const allowedList = allowedOrigins.split(',').map(domain =>
          domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
        );
        const proxyDomain = env.PROXY_DOMAIN || url.host;

        try {
          const originUrl = new URL(requestOrigin);
          const hostname = originUrl.hostname;

          const isProxyDomain = hostname === proxyDomain;
          const isAllowed = isProxyDomain || allowedList.some(allowedDomain => {
            return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`);
          });

          if (!isAllowed) {
            return new Response('Access denied: Origin not allowed', {
              status: 403,
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        } catch (e) {
          return new Response('Access denied: Invalid origin format', {
            status: 403,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
      } else {
        return new Response('Access denied: Direct access not allowed', {
          status: 403,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }

    // --- 2. 缓存清理逻辑优化 ---
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
        return new Response('Please specify a full cached URL via the "url" query parameter to purge. Example: /purge-cache?url=https...&key=...');
      }
    }

    // --- 3. 严密性: 构建精确的目标 URL ---
    let targetHost: string;
    // Support material icons as well
    if (url.pathname.startsWith('/css') || url.pathname.startsWith('/css2') || url.pathname.startsWith('/icon')) {
      targetHost = 'fonts.googleapis.com';
    } else {
      targetHost = 'fonts.gstatic.com';
    }

    const targetUrl = new URL(`https://${targetHost}${url.pathname}${url.search}`);

    // --- 4. 安全性: 过滤请求头，防止泄露无用或敏感信息 (如 Cookie) 至 Google ---
    const headers = new Headers();
    const headersToForward = ['Accept', 'Accept-Language', 'User-Agent', 'Referer'];
    headersToForward.forEach(header => {
      const val = request.headers.get(header);
      if (val) headers.set(header, val);
    });

    const userAgent = request.headers.get('User-Agent') || 'Unknown';

    // --- 5. 性能与严密性: 基于 User-Agent 的 CSS 缓存隔离 ---
    // Google serves totally different woff/woff2 font CSS links depending on browser UA!
    const cacheUrl = new URL(request.url);
    if (targetHost === 'fonts.googleapis.com') {
      cacheUrl.searchParams.set('ua', userAgent);
    }
    const cacheKey = new Request(cacheUrl.toString(), request);

    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (response) {
      const cachedResponse = new Response(response.body, response);
      cachedResponse.headers.set('Access-Control-Allow-Origin', '*');
      return cachedResponse;
    }

    try {
      const proxyRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers: headers,
        redirect: 'follow'
      });

      response = await fetch(proxyRequest);

      if (response.ok) {
        let proxyResponse: Response;

        if (targetHost === 'fonts.googleapis.com') {
          try {
            const arrayBuffer = await response.arrayBuffer();
            const cssText = new TextDecoder('utf-8').decode(arrayBuffer);

            const proxyDomain = env.PROXY_DOMAIN || url.host;
            const proxyUrl = `https://${proxyDomain}`;

            // 全局包含且容错地替换所有 Google Fonts 连接为当前代理地址
            const modifiedCss = cssText.replace(/https?:\/\/(fonts\.gstatic\.com|fonts\.googleapis\.com)/g, proxyUrl);

            proxyResponse = new Response(modifiedCss, {
              status: response.status,
              statusText: response.statusText,
              headers: new Headers(response.headers)
            });
            proxyResponse.headers.set('Content-Type', 'text/css; charset=utf-8');
          } catch (modError: unknown) {
            console.error(`CSS modification error: ${(modError as Error).message}`);
            proxyResponse = new Response(response.body, response);
          }
        } else {
          proxyResponse = new Response(response.body, response);
        }

        // --- 6. 性能优化: 强制客户端长效缓存 (更新至1年=31536000秒) ---
        proxyResponse.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        proxyResponse.headers.set('Access-Control-Allow-Origin', '*');

        // 移除多余的安全头，避免体积开销影响加载性能
        proxyResponse.headers.delete('X-Frame-Options');
        proxyResponse.headers.delete('X-XSS-Protection');

        ctx.waitUntil(cache.put(cacheKey, proxyResponse.clone()));

        return proxyResponse;
      } else {
        console.error(`Google response error: ${response.status} for ${targetUrl.toString()}`);
        return new Response(`Proxy failed: Google returned ${response.status}`, { status: response.status });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Fetch error: ${errorMessage}`);
      return new Response(`Proxy error: ${errorMessage}`, { status: 500 });
    }
  },
};
