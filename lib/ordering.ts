// Compare numbered names as people read them: 1.9, 1.10, 1.12.
const names = new Intl.Collator(["ru", "en"], { numeric: true, sensitivity: "base" });

export function compareGroups(
  a: { key: string; name: string },
  b: { key: string; name: string },
): number {
  const sectionFirst = Number(b.key.startsWith("section:")) - Number(a.key.startsWith("section:"));
  if (sectionFirst !== 0) return sectionFirst;
  const byName = names.compare(a.name, b.name);
  return byName || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
