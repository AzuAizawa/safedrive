import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const allowedTargets = [
  path.join(repositoryRoot, "dist"),
  path.join(repositoryRoot, "node_modules", ".vite"),
].map((target) => path.resolve(target));

for (const target of allowedTargets) {
  const relativeTarget = path.relative(repositoryRoot, target);
  const isInsideRepository =
    relativeTarget !== "" &&
    relativeTarget !== ".." &&
    !relativeTarget.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeTarget);

  if (!isInsideRepository || !allowedTargets.includes(target)) {
    throw new Error(`Refusing to clean unsafe target: ${target}`);
  }

  await rm(target, { recursive: true, force: true });
  console.log(`Cleaned ${relativeTarget}`);
}
