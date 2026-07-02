/**
 * D2-04 default-deny env allowlist: children of a spawned stage get only
 * these 5 keys — never a spread of `process.env` — so parent-process
 * secrets/tokens can never leak into an install/build/lint/test/start child.
 *
 * Deliberately excludes `NODE_ENV` (correction to 02-RESEARCH.md's Pattern 2
 * example and D2-04's illustrative list): `npm ci` with `NODE_ENV=production`
 * skips installing `devDependencies` entirely, and `sirv-cli`/`@angular/cli`
 * are devDependencies of `stacks/angular/template/package.json` (Plan 02-02).
 * Setting it here would silently break the install stage while `install`
 * itself still reports `exitCode: 0` — leaving `NODE_ENV` unset is npm's
 * normal default (installs both prod + dev deps) and is correct.
 */
export function buildAllowlistedEnv(npmCacheDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    npm_config_cache: npmCacheDir,
    npm_config_ignore_scripts: "true",
    CI: "1",
  };
}
