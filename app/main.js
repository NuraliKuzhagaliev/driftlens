import {analyze} from './core.js';
import {matchLog, correlate} from './incident.js';
import {buildPreview, applyPreview} from './repair.js';

const paths={contract:'./fixtures/contract.json',source:'./fixtures/app.py',example:'./fixtures/.env.example',deployment:'./fixtures/compose.yaml'};
const hints={contract:'Required environment variables',source:'Application code · Python or JavaScript',example:'Developer setup · .env.example',deployment:'Deployment configuration · compose.yaml'};
const state={contract:'',source:'',example:'',deployment:''};
let selected='contract';
let lastReport=null;
const $=id=>document.getElementById(id);
const editor=$('editor');
function saveEditor(){state[selected]=editor.value;}
function select(tab){saveEditor();selected=tab;document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.tab===tab));editor.value=state[tab];$('fileHint').textContent=hints[tab];updateLines();}
function updateLines(){$('lineCount').textContent=`${editor.value.split('\n').length} lines`;}
function elt(tag,className,content){const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;}
function render(report){lastReport=report;const status=$('status');status.className=`status ${report.status.toLowerCase()}`;status.querySelector('.status-icon').textContent=report.status==='READY'?'✓':report.status==='HOLD'?'!':'?';status.querySelector('strong').textContent=report.status==='HOLD'?'HOLD RELEASE':report.status==='READY'?'READY TO PROCEED':'REVIEW REQUIRED';status.querySelector('div span').textContent=report.status==='HOLD'?'Fix blocking drift before deployment.':report.status==='READY'?'All static contract checks passed.':'Review warnings before deployment.';
  $('requiredCount').textContent=report.metrics.required;$('blockerCount').textContent=report.metrics.blockers;$('warningCount').textContent=report.metrics.warnings;$('findingTotal').textContent=`${report.findings.length} issue${report.findings.length===1?'':'s'}`;
  const list=$('findings');list.replaceChildren();if(!report.findings.length){list.append(elt('div','empty','No configuration drift found in these static checks.'));return;}
  report.findings.forEach(item=>{const box=elt('article','finding');const top=elt('div','finding-top');top.append(elt('span',`pill ${item.severity==='WARN'?'warn':''}`,item.severity),elt('b','',item.title));box.append(top,elt('p','',`${item.location} · ${item.why}`),elt('code','',item.fix));list.append(box);});
}
function scan(){saveEditor();try{render(analyze(state));}catch(error){lastReport=null;$('status').className='status hold';$('status').querySelector('strong').textContent='INPUT ERROR';$('status').querySelector('div span').textContent=error.message;}}
async function loadSample(){for(const [key,path] of Object.entries(paths)){const response=await fetch(path);if(!response.ok)throw new Error(`Could not load ${path}`);state[key]=await response.text();}editor.value=state[selected];updateLines();scan();}
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.tab)));
editor.addEventListener('input',updateLines);$('scan').addEventListener('click',scan);
$('broken').addEventListener('click',()=>loadSample().catch(error=>alert(error.message)));
// ── Repair preview ────────────────────────────────────────────────────────────
const repairModal   = $('repairModal');
const repairPreview = $('repairPreviewBody');
let   pendingPreview = null;

/** Render the preview body DOM from a buildPreview() result. */
function renderRepairPreview(preview) {
  repairPreview.replaceChildren();

  // .env.example block
  const envBlock = elt('div','modal-file-block');
  envBlock.append(elt('div','modal-file-label','.ENV.EXAMPLE'));
  if (preview.envChanges.length) {
    const diff = elt('div','modal-diff');
    preview.envChanges.forEach(line => {
      const span = elt('span','modal-diff-add', `+ ${line}`);
      diff.append(span, document.createTextNode('\n'));
    });
    envBlock.append(diff);
  } else {
    envBlock.append(elt('p','modal-no-change','No changes needed.'));
  }
  repairPreview.append(envBlock);

  // compose.yaml block
  const composeBlock = elt('div','modal-file-block');
  composeBlock.append(elt('div','modal-file-label','COMPOSE.YAML'));
  if (preview.composeError) {
    const note = elt('div','modal-error-note', `⚠ ${preview.composeError}`);
    composeBlock.append(note);
  } else if (preview.composeChanges.length) {
    const diff = elt('div','modal-diff');
    preview.composeChanges.forEach(line => {
      const span = elt('span','modal-diff-add', `+ ${line}`);
      diff.append(span, document.createTextNode('\n'));
    });
    composeBlock.append(diff);
  } else {
    composeBlock.append(elt('p','modal-no-change','No changes needed.'));
  }
  repairPreview.append(composeBlock);
}

$('repair').addEventListener('click', () => {
  saveEditor();
  let report;
  try { report = analyze(state); } catch (error) { alert(error.message); return; }

  const preview = buildPreview(state, report.findings);

  if (!preview.hasChanges && !preview.composeError) {
    alert('No blockers to repair. Run the release gate first, or check that your files are loaded.');
    return;
  }

  pendingPreview = preview;
  renderRepairPreview(preview);
  repairModal.showModal();
});

$('repairCancel').addEventListener('click', () => {
  pendingPreview = null;
  repairModal.close();
});

$('repairConfirm').addEventListener('click', () => {
  if (!pendingPreview) { repairModal.close(); return; }
  const preview = pendingPreview;
  pendingPreview = null;
  repairModal.close();

  // Apply the confirmed preview
  const newState = applyPreview(state, preview);
  state.example    = newState.example;
  state.deployment = newState.deployment;

  editor.value = state[selected];
  updateLines();
  scan();
});
$('upload').addEventListener('change',async event=>{const file=event.target.files[0];if(file){state[selected]=await file.text();editor.value=state[selected];updateLines();event.target.value='';}});
$('download').addEventListener('click',()=>{if(!lastReport)return;const blob=new Blob([JSON.stringify(lastReport,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='driftlens-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
loadSample().catch(error=>{console.error(error);$('status').querySelector('div span').textContent='Start a local server to load the sample files.';});

// ── Incident-to-Guard UI ─────────────────────────────────────────────────────

const incidentEditor = $('incidentEditor');
const incidentLineCount = $('incidentLineCount');
const incidentStatus = $('incidentStatus');
const incidentChain = $('incidentChain');

function updateIncidentLines() {
  incidentLineCount.textContent = `${incidentEditor.value.split('\n').length} lines`;
}

/**
 * Render the causal-chain result into the incident panel.
 * Accepts the object returned by buildChain().
 */
function renderChain(chain) {
  // Update status banner
  incidentStatus.className = `status ${chain.status}`;
  incidentStatus.querySelector('.status-icon').textContent =
    chain.status === 'matched' ? '!' : chain.status === 'unrelated' ? '?' : '✕';
  incidentStatus.querySelector('strong').textContent =
    chain.status === 'matched'   ? 'CAUSAL MATCH'     :
    chain.status === 'unrelated' ? 'VARIABLE UNKNOWN'  :
                                   'UNRECOGNIZED LOG';
  incidentStatus.querySelector('div span').textContent = chain.summary;

  incidentChain.replaceChildren();

  if (chain.status === 'unrecognized') {
    incidentChain.append(elt('div', 'empty', 'Log did not match any documented error pattern. Check the Limitations section below.'));
    return;
  }

  // Step 1 — Incident
  const step1 = elt('article', 'finding');
  const top1 = elt('div', 'finding-top');
  top1.append(elt('span', 'pill', '01'), elt('b', '', 'Incident'));
  step1.append(top1,
    elt('p', '', `Pattern: ${chain.patternLabel} (${chain.runtime})`),
    elt('code', '', `Missing variable: ${chain.variable}`));
  incidentChain.append(step1);

  // Step 2 — Source reference
  const step2 = elt('article', 'finding');
  const top2 = elt('div', 'finding-top');
  top2.append(elt('span', 'pill', '02'), elt('b', '', 'Source reference'));
  step2.append(top2, elt('p', '', chain.sourceRef));
  incidentChain.append(step2);

  // Step 3 — Release-gate findings
  const step3 = elt('article', 'finding');
  const top3 = elt('div', 'finding-top');
  top3.append(elt('span', 'pill warn', '03'), elt('b', '', 'Release-gate findings'));
  if (chain.scanFindings.length) {
    chain.scanFindings.forEach(f => {
      step3.append(elt('p', '', `${f.location} · ${f.title}`), elt('code', '', f.fix));
    });
  } else if (chain.status === 'unrelated') {
    step3.append(elt('p', '', `${chain.variable} was not found in the current scan. Run a release-gate scan first, or check the contract.`));
  } else {
    step3.append(elt('p', '', 'No open findings for this variable — the release gate already has this entry, or no scan has been run yet.'));
  }
  incidentChain.append(step3);

  // Step 4 — Proposed repair
  if (chain.repairs.length) {
    const step4 = elt('article', 'finding');
    const top4 = elt('div', 'finding-top');
    top4.append(elt('span', 'pill', '04'), elt('b', '', 'Proposed repair'));
    chain.repairs.forEach(r => step4.append(elt('code', '', r)));
    incidentChain.append(step4);
  }
}

/**
 * Build the causal-chain descriptor from a matchLog result and correlate output.
 * This is a pure function that does not touch the DOM.
 */
export function buildChain(logText, report) {
  const match = matchLog(logText);

  if (!match.matched) {
    return {
      status: 'unrecognized',
      summary: 'Log did not match any documented error pattern.',
    };
  }

  const { variable, patternLabel, runtime } = match;
  const { scanFindings } = correlate(variable, report);

  // Describe how the variable appears in the source files known to the gate
  const sourceRef = report
    ? `${variable} is referenced in the application source checked by the release gate.`
    : `${variable} extracted from log. Run a release-gate scan to correlate with contract findings.`;

  const repairs = scanFindings.filter(f => f.fix).map(f => f.fix);

  if (!scanFindings.length) {
    return {
      status: 'unrelated',
      summary: `${variable} was extracted from the log but has no open findings in the current scan. Ensure a scan has been run and that this variable is in the contract.`,
      variable, patternLabel, runtime, sourceRef, scanFindings, repairs,
    };
  }

  return {
    status: 'matched',
    summary: `${variable} is missing at runtime and has ${scanFindings.length} open release-gate finding${scanFindings.length === 1 ? '' : 's'}.`,
    variable, patternLabel, runtime, sourceRef, scanFindings, repairs,
  };
}

function analyseIncident() {
  const logText = incidentEditor.value;
  const chain = buildChain(logText, lastReport);
  renderChain(chain);
}

incidentEditor.addEventListener('input', updateIncidentLines);
$('analyseIncident').addEventListener('click', analyseIncident);

$('loadIncident').addEventListener('click', async () => {
  try {
    const response = await fetch('./fixtures/incident.log');
    if (!response.ok) throw new Error('Could not load fixtures/incident.log');
    incidentEditor.value = await response.text();
    updateIncidentLines();
  } catch (err) {
    alert(err.message);
  }
});

$('incidentUpload').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (file) {
    incidentEditor.value = await file.text();
    updateIncidentLines();
    event.target.value = '';
  }
});
