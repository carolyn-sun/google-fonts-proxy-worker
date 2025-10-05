# Google Fonts Proxy Worker

A Cloudflare Worker that proxies Google Fonts requests to improve performance and privacy. Also, consider you may have visitors from China, where Google services are blocked.

## Environment Variables

- `CACHE_PURGE_KEY`: A secret key used to authorize cache purge requests.
- `PROXY_DOMAIN`: The domain used for proxying requests (default: the original request's host).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fcarolyn-sun%2Fgoogle-fonts-proxy-worker)