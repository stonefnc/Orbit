/**
 * Resolve architect / designer names: [P84 (architect)](https://www.wikidata.org/wiki/Property:P84) and, for
 * artworks and many monuments, [P170 (creator)](https://www.wikidata.org/wiki/Property:P170) when present.
 */

const WD_API = "https://www.wikidata.org/w/api.php";

type WbEntity = Record<string, unknown>;

function labelFromEntity(ent: WbEntity | undefined): string | null {
  const labels = ent?.labels as Record<string, { value?: string }> | undefined;
  if (!labels) return null;
  if (typeof labels.en?.value === "string" && labels.en.value.trim()) return labels.en.value.trim();
  for (const v of Object.values(labels)) {
    if (typeof v?.value === "string" && v.value.trim()) return v.value.trim();
  }
  return null;
}

function collectStatementItemIds(entityJson: WbEntity, property: string): string[] {
  const claims = entityJson.claims as Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> | undefined;
  const stmts = claims?.[property];
  if (!Array.isArray(stmts)) return [];
  const ids: string[] = [];
  for (const stmt of stmts) {
    const val = stmt?.mainsnak?.datavalue?.value as { id?: string; "numeric-id"?: number } | undefined;
    if (!val || typeof val !== "object") continue;
    if (typeof val.id === "string" && /^Q\d+$/i.test(val.id)) {
      ids.push(val.id.toUpperCase());
    } else if (typeof val["numeric-id"] === "number") {
      ids.push(`Q${val["numeric-id"]}`);
    }
  }
  return ids;
}

/**
 * Returns human-readable architect / designer names linked from the building's Wikidata item.
 */
export async function fetchArchitectLabelsFromWikidata(entityQid: string): Promise<string[]> {
  const root = entityQid.trim().toUpperCase();
  if (!/^Q\d+$/.test(root)) return [];

  const claimsUrl = `${WD_API}?action=wbgetentities&ids=${encodeURIComponent(root)}&props=claims&format=json&origin=*`;
  const res1 = await fetch(claimsUrl);
  if (!res1.ok) return [];
  const data1 = (await res1.json()) as { entities?: Record<string, WbEntity> };
  const ent = data1.entities?.[root];
  if (!ent) return [];

  const itemIds = [...new Set([...collectStatementItemIds(ent, "P84"), ...collectStatementItemIds(ent, "P170")])];
  if (itemIds.length === 0) return [];

  const labelsUrl = `${WD_API}?action=wbgetentities&ids=${encodeURIComponent(itemIds.join("|"))}&props=labels&languages=en&format=json&origin=*`;
  const res2 = await fetch(labelsUrl);
  if (!res2.ok) return [];
  const data2 = (await res2.json()) as { entities?: Record<string, WbEntity> };
  const entities = data2.entities ?? {};
  const names: string[] = [];
  for (const q of itemIds) {
    const name = labelFromEntity(entities[q]);
    if (name) names.push(name);
  }
  return names;
}
