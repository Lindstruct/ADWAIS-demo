import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [baseline] = process.argv.slice(2);
assert.ok(baseline, 'Pass the path to the OpenAPI document before regeneration.');
const regenerated = new URL('../../../docs/openapi/v1.json', import.meta.url);
async function readContract(source) {
  const document = JSON.parse(await readFile(source, 'utf8'), (_, value) =>
    typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value);
  delete document.servers;
  return document;
}
assert.deepEqual(await readContract(regenerated), await readContract(baseline), 'Regenerated OpenAPI differs from the checked-in API contract.');
