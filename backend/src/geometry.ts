/**
 * Loads and validates the generated server geometry manifest
 * (`backend/assets/campus.geometry.json`, emitted by
 * `frontend/scripts/gen_campus.py`). This is the backend's single source of
 * authoritative campus geometry; it is never hand-edited.
 *
 * The manifest is validated against the shared `geometryManifestSchema` and its
 * `version` is checked against `GEOMETRY_MANIFEST_VERSION` — an absent,
 * malformed, or version-mismatched (stale) manifest is a hard failure. The
 * server fails fast at startup (`index.ts`) and `/health/ready` reports 503
 * (`app.ts`) so a bad manifest can never be silently served.
 *
 * Kept dependency-light (no config/logger imports) so the load/validate/fail
 * logic is unit-testable service-free; callers do the logging with their
 * bound loggers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GEOMETRY_MANIFEST_VERSION,
  geometryManifestSchema,
  type GeometryManifest,
} from "@metaverse/shared";

/**
 * Default on-disk location, resolved relative to this module so it works both
 * from `src` (tsx/dev) and `dist` (built image): the committed manifest sits at
 * `backend/assets/campus.geometry.json`, copied into the Docker image.
 */
const DEFAULT_MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "campus.geometry.json",
);

/** Raised on any load/validate/version failure. */
export class GeometryManifestError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "GeometryManifestError";
  }
}

/** Resolve the manifest path, allowing a `GEOMETRY_MANIFEST_PATH` override. */
export function geometryManifestPath(): string {
  return process.env.GEOMETRY_MANIFEST_PATH ?? DEFAULT_MANIFEST_PATH;
}

/**
 * Read, parse, validate, and version-check the manifest at `filePath`. Throws
 * `GeometryManifestError` on a missing file, malformed JSON, schema violation,
 * or a `version` other than `GEOMETRY_MANIFEST_VERSION`.
 */
export function loadGeometryManifest(filePath: string = geometryManifestPath()): GeometryManifest {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new GeometryManifestError(`geometry manifest not readable at ${filePath}`, error);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new GeometryManifestError(`geometry manifest is not valid JSON at ${filePath}`, error);
  }

  const parsed = geometryManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new GeometryManifestError(
      `geometry manifest failed schema validation at ${filePath}`,
      parsed.error.issues,
    );
  }

  if (parsed.data.version !== GEOMETRY_MANIFEST_VERSION) {
    throw new GeometryManifestError(
      `stale geometry manifest at ${filePath}: version ${parsed.data.version} ` +
        `!= expected ${GEOMETRY_MANIFEST_VERSION}`,
    );
  }

  return parsed.data;
}

let cached: GeometryManifest | undefined;

/**
 * Memoized accessor for the valid manifest. Caches only on success, so a fixed
 * file can recover without a restart; re-throws on every failing call.
 */
export function getGeometryManifest(): GeometryManifest {
  if (cached) return cached;
  cached = loadGeometryManifest();
  return cached;
}

/** True when the manifest loads and validates — used by the readiness probe. */
export function geometryManifestReady(): boolean {
  try {
    getGeometryManifest();
    return true;
  } catch {
    return false;
  }
}
