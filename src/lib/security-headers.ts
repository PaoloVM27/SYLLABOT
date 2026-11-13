export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  // TanStack hydration and React styles currently require unsafe-inline; never unsafe-eval.
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com https://accounts.google.com https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.googleusercontent.com https://www.gstatic.com",
    "connect-src 'self' https://syllabot-ubc7.onrender.com https://*.googleapis.com https://*.google.com https://*.gstatic.com https://*.firebaseapp.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    "frame-src https://accounts.google.com https://syllabot-unmsm.firebaseapp.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

export function secureResponse(response: Response): Response {
  if (import.meta.env.DEV) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
