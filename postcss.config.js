/**
 * postcss.config.js
 * Standard Tailwind v3 + Autoprefixer pipeline (ADR-019). CommonJS to match next.config.js's
 * existing convention — no "type": "module" in package.json.
 */

module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
