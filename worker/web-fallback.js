/**
 * Runs only for /web/* (see run_worker_first in wrangler.jsonc). The web app is a single-page app, so a
 * deep link such as /web/community/abc has no file behind it: answer with the app shell instead of a 404.
 * Everything else on the site is plain static files served by Cloudflare directly.
 */
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    const url = new URL(request.url);
    // A missing file (script, image, font) should stay a 404; only page-like addresses get the shell.
    if (/\.[a-z0-9]{2,5}$/i.test(url.pathname)) return response;
    return env.ASSETS.fetch(new Request(new URL("/web/index.html", url), request));
  },
};
