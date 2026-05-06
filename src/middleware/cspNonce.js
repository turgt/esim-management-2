import crypto from 'node:crypto';

// Generates a per-request CSP nonce and exposes it to templates as
// `cspNonce` (via res.locals). Mount this middleware BEFORE helmet's CSP so
// the nonce is available when the policy is built.
//
// Usage in Express:
//   app.use(cspNonce);
//   app.use(helmet({
//     contentSecurityPolicy: {
//       directives: {
//         scriptSrc: [
//           "'self'",
//           (req, res) => `'nonce-${res.locals.cspNonce}'`,
//           // ... other sources
//         ]
//       }
//     }
//   }));
//
// And in EJS templates:
//   <script nonce="<%= cspNonce %>"> ... </script>
//
// This module ships the nonce generator only — wiring it into helmet and
// dropping `'unsafe-inline'` is done in subsequent migration PRs as each
// template is converted away from inline event handlers.
export function cspNonce(req, res, next) {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
}

export default cspNonce;
