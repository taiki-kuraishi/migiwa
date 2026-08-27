// Fails when the lockfile resolves any package name to more than one version.
// bun has no `dedupe` command, so this is our equivalent of `bun dedupe --ci`:
// it keeps the dependency tree flat and blocks a PR that introduces a second
// copy of an already-present package at a different version.
import lockfile from "../bun.lock";

// Packages that CANNOT be deduplicated because independent tools pin different
// EXACT versions transitively — overriding them would break those tools.
// Each entry needs a `bun pm why <name>` justification. Keep this list minimal.
const ALLOWLIST = new Set<string>([
  // rolldown pins =0.147.0, knip->oxc-parser pins ^0.143.0, vite-plus-core pins
  // =0.146.0. No single version satisfies all three; an override breaks rolldown.
  "@oxc-project/types",
]);

// An id is "name@version"; the name may itself start with "@" (scoped), so split
// on the last "@" that is not the leading scope marker.
function splitId(id: string): { name: string; version: string } | null {
  const at = id.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

const versionsByName = new Map<string, Set<string>>();
for (const entry of Object.values(lockfile.packages)) {
  const parsed = splitId(entry[0]);
  // Workspace packages (version "workspace:...") are not real duplicates.
  if (!parsed || parsed.version.startsWith("workspace:")) {
    continue;
  }
  const set = versionsByName.get(parsed.name) ?? new Set<string>();
  set.add(parsed.version);
  versionsByName.set(parsed.name, set);
}

const duplicates = [...versionsByName.entries()]
  .filter(([name, versions]) => versions.size > 1 && !ALLOWLIST.has(name))
  .toSorted(([a], [b]) => a.localeCompare(b));

if (duplicates.length > 0) {
  console.error(`Found ${duplicates.length} package(s) resolved to multiple versions:`);
  for (const [name, versions] of duplicates) {
    console.error(`  ${name}: ${[...versions].toSorted().join(", ")}`);
  }
  console.error("\nAlign the versions (the culprit is usually a dep pinning an exact version;");
  console.error("check with `bun pm why <name>`), commit bun.lock, or add a justified entry");
  console.error("to ALLOWLIST in this script if the duplicate is genuinely unavoidable.");
  process.exitCode = 1;
} else {
  console.log(
    `OK: no unexpected duplicate package versions across ${versionsByName.size} packages.`,
  );
}
