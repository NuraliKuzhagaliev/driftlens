// Locate one service's environment block without combining keys from other services.
// This intentionally supports the simple Compose mapping/list syntax used by DriftLens.
const indentOf = line => (line.match(/^\s*/)?.[0].length ?? 0);
const nameOf = line => line.match(/^\s*(?:([A-Za-z0-9_.-]+)|'([^']+)'|"([^"]+)"):\s*(?:#.*)?$/)?.slice(1).find(Boolean);

export function findEnvironmentBlock(text, service) {
  const lines = text.split(/\r?\n/);
  const servicesIdx = lines.findIndex(line => /^\s*services:\s*(?:#.*)?$/.test(line));
  let serviceStart = -1;
  let serviceEnd = lines.length;

  if (servicesIdx >= 0) {
    const servicesIndent = indentOf(lines[servicesIdx]);
    let childIndent = -1;
    for (let i = servicesIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const indent = indentOf(line);
      if (indent <= servicesIndent) break;
      const name = nameOf(line);
      if (name && childIndent < 0) childIndent = indent;
      if (name && indent === childIndent) {
        if (serviceStart >= 0) { serviceEnd = i; break; }
        if (!service || name === service) serviceStart = i;
      }
    }
    if (service && serviceStart < 0) throw new Error(`Service "${service}" was not found in compose.yaml.`);
    if (!service && serviceStart < 0) throw new Error('No service was found in compose.yaml.');
  } else if (service) {
    throw new Error(`Service "${service}" was not found in compose.yaml.`);
  }

  const start = serviceStart >= 0 ? serviceStart + 1 : 0;
  const end = serviceStart >= 0 ? serviceEnd : lines.length;
  const serviceIndent = serviceStart >= 0 ? indentOf(lines[serviceStart]) : -1;
  for (let i = start; i < end; i++) {
    const line = lines[i];
    const match = line.match(/^\s*environment:\s*(.*)$/);
    if (!match || indentOf(line) <= serviceIndent) continue;
    if (match[1] && !match[1].startsWith('#')) {
      throw new Error('Inline environment syntax is not supported; use a mapping or list in compose.yaml.');
    }
    const baseIndent = indentOf(line);
    let blockEnd = i + 1;
    while (blockEnd < end) {
      const next = lines[blockEnd];
      if (next.trim() && !next.trim().startsWith('#') && indentOf(next) <= baseIndent) break;
      blockEnd++;
    }
    return { lines, environmentIdx: i, blockEnd, baseIndent };
  }
  return { lines, environmentIdx: -1, blockEnd: -1, baseIndent: -1 };
}
