import { readFileSync, readdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data", "generations");
const ROUTES_FILE = join(DATA_DIR, "turntable-routes.json");

function readTurntableRoutes(): Map<string, { href: string; label: string; synthetic: boolean }> {
  const routes = new Map<string, { href: string; label: string; synthetic: boolean }>();

  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    const genPath = join(DATA_DIR, file);
    const genData = JSON.parse(readFileSync(genPath, "utf8"));

    const turntable = genData.model3d?.turntable ?? null;
    if (!turntable) continue;

    routes.set(turntable, {
      href: `/911/${genData.id}`,
      label: genData.name,
      synthetic: genData.model3d?.turntableSynthetic === true,
    });
  }

  return routes;
}

function main() {
  const routes = readTurntableRoutes();

  const routesArray = Array.from(routes.entries()).map(([key, value]) => ({
    key,
    ...value,
  }));

  const output = JSON.stringify(routesArray, null, 2);
  const stream = createWriteStream(ROUTES_FILE);
  stream.write(output);
  stream.end();
  console.log(`Generated ${routes.size} turntable routes in ${ROUTES_FILE}`);
}

main();