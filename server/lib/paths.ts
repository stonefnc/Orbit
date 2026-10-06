import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the server reads its own files and writes what it learns.
 *
 * From a checkout all three are the repository folder (and `.cache` inside it). The packaged Windows app moves them out
 * of its install folder, which should stay read-only: keys and caches go to the user's app-data folder.
 *  - `ORBIT_APP_DIR`   the folder holding bundled read-only data (`data/notable-aircraft.json`)
 *  - `ORBIT_ENV_DIR`   the folder holding `.env` / `.env.local` (the Keys menu writes `.env.local` here)
 *  - `ORBIT_CACHE_DIR` the folder for downloaded and computed caches
 */
export const APP_ROOT = process.env.ORBIT_APP_DIR?.trim() || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_DIR = process.env.ORBIT_ENV_DIR?.trim() || APP_ROOT;
export const CACHE_ROOT = process.env.ORBIT_CACHE_DIR?.trim() || join(APP_ROOT, ".cache");
