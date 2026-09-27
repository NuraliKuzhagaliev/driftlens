import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, parseDeployment, parseReferences} from '../app/core.js';

const input = {source:'os.environ["DATABASE_URL"]\nos.getenv("PAYMENT_API_KEY")\nprocess.env.PORT',example:'DATABASE_URL=<set-me>\nPORT=8080',deployment:'services:\n  checkout:\n    environment:\n      DATABASE_URL: ${DATABASE_URL}\n      PORT: ${PORT}',contract:{required:['DATABASE_URL','PAYMENT_API_KEY','PORT']}};
test('detects one omitted required key in both setup and deployment', () => {
  const result = analyze(input);
  assert.equal(result.status,'HOLD');
  assert.equal(result.metrics.blockers,2);
  assert.deepEqual(result.findings.map(f => f.location),['.env.example','compose.yaml']);
});
test('clears gate after both sources have been repaired', () => {
  const result = analyze({...input,example:input.example+'\nPAYMENT_API_KEY=<set-me>',deployment:input.deployment+'\n      PAYMENT_API_KEY: ${PAYMENT_API_KEY}'});
  assert.equal(result.status,'READY');
  assert.equal(result.findings.length,0);
});
test('accepts mapping and list deployment forms, but ignores unrelated YAML', () => {
  assert.deepEqual([...parseDeployment('environment:\n  - PORT=8080\nvolumes:\n  - SECRET=oops').keys()],['PORT']);
  assert.equal(parseReferences('os.getenv("PORT")\nprocess.env.PORT').get('PORT').length,2);
});
test('flags suspicious concrete credentials in example', () => {
  const result=analyze({...input,example:input.example+'\nPAYMENT_API_KEY=sk_live_abc',deployment:input.deployment+'\n      PAYMENT_API_KEY: ${PAYMENT_API_KEY}'});
  assert.equal(result.metrics.blockers,1);
  assert.match(result.findings[0].title,/credential/);
});
