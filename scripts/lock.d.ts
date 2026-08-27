// The bun.lock file is JSONC; bun's importer parses it at runtime. This ambient
// declaration gives it a type so scripts can import it without an assertion.
declare module "*.lock" {
  const lockfile: { packages: Record<string, [id: string, ...rest: unknown[]]> };
  export default lockfile;
}
