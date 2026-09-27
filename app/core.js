// Pure analysis module. All inputs remain in the browser; no network requests.
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

export function parseEnv(text) {
  const entries = new Map();
  text.split(/\r?\n/).forEach((line, i) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (match) entries.set(match[1], { line: i + 1, value: line.slice(line.indexOf('=') + 1).trim() });
  });
  return entries;
}

export function parseReferences(text) {
  const references = new Map();
  const patterns = [
    /\bos\.(?:getenv|environ\.get)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
    /\bos\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
    /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
    /\bprocess\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      if (!references.has(key)) references.set(key, []);
      references.get(key).push(lineOf(text, match.index));
    }
  }
  return references;
}

export function parseDeployment(text) {
  const entries = new Map();
  const lines = text.split(/\r?\n/);
  let inEnvironment = false;
  let baseIndent = -1;
  lines.forEach((line, i) => {
    const indent = (line.match(/^\s*/) || [''])[0].length;
    if (/^\s*environment:\s*(?:#.*)?$/.test(line)) {
      inEnvironment = true;
      baseIndent = indent;
      return;
    }
    if (inEnvironment && line.trim() && !line.trim().startsWith('#') && indent <= baseIndent) inEnvironment = false;
    if (!inEnvironment) return;
    const map = line.match(/^\s*([A-Z][A-Z0-9_]*):\s*(.*)$/);
    const list = line.match(/^\s*-\s*([A-Z][A-Z0-9_]*)(?:\s*=.*)?$/);
    const key = map?.[1] || list?.[1];
    if (key) entries.set(key, {line:i+1, value:map?.[2] || ''});
  });
  return entries;
}

export function analyze({ source, example, deployment, contract }) {
  const spec = typeof contract === 'string' ? JSON.parse(contract) : contract;
  if (!spec || !Array.isArray(spec.required) || !spec.required.every(k => typeof k === 'string' && /^[A-Z][A-Z0-9_]*$/.test(k))) {
    throw new Error('Contract requires a "required" array of uppercase environment keys.');
  }
  const referenced = parseReferences(source);
  const documented = parseEnv(example);
  const deployed = parseDeployment(deployment);
  const findings = [];
  const add = (severity, key, location, title, why, fix) => findings.push({
    id:`${severity.toLowerCase()}-${key}-${findings.length+1}`,severity,key,location,title,why,fix
  });
  for (const key of spec.required) {
    if (!referenced.has(key)) add('WARN',key,'app source',`${key} is required but unused`,
      'The contract describes a configuration key that the application never reads.',`Remove ${key} from the contract if obsolete, or wire it into the application.`);
    if (!documented.has(key)) add('BLOCKER',key,'.env.example',`${key} is absent from setup instructions`,
      'A developer following the example file cannot configure this required key.',`Add ${key}=<set-me> to .env.example.`);
    if (!deployed.has(key)) add('BLOCKER',key,'compose.yaml',`${key} is absent from deployment`,
      'A local run can succeed while the deployed container starts without this required value.',`Add ${key}: \${${key}} to the service environment in compose.yaml.`);
  }
  for (const [key, lines] of referenced) {
    if (!spec.required.includes(key) && !documented.has(key)) add('WARN',key,`app source:${lines[0]}`,`${key} is used but undocumented`,
      'The application reads this key, but the example and required contract do not mention it.',`Add ${key} to the contract and .env.example, or remove the stale reference.`);
  }
  for (const [key, entry] of documented) {
    if (/^(?:secret|password|token|apikey|api_key)\b/i.test(entry.value) || (/(?:SECRET|PASSWORD|TOKEN|API_KEY)/.test(key) && entry.value && !/^<|^\$\{|^your[-_]/i.test(entry.value))) {
      add('BLOCKER',key,`.env.example:${entry.line}`,`${key} may contain a real credential`,
        'Example configuration appears to contain a concrete sensitive value.',`Replace the example with ${key}=<set-me> and rotate the value if it was real.`);
    }
  }
  findings.sort((a,b) => Number(b.severity==='BLOCKER') - Number(a.severity==='BLOCKER') || a.key.localeCompare(b.key));
  const blockers = findings.filter(f => f.severity === 'BLOCKER').length;
  return {
    status:blockers ? 'HOLD' : findings.length ? 'REVIEW' : 'READY',
    metrics:{required:spec.required.length, referenced:referenced.size, documented:documented.size, deployed:deployed.size, blockers, warnings:findings.length-blockers},
    findings,
    checkedAt:new Date().toISOString(),
    limitations:['Static checks cannot prove runtime values exist or that credentials are valid.','Dynamic environment names and YAML anchors are not parsed.']
  };
}
