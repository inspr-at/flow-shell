import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function firstExisting(candidates, label) {
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(`${label} not found (tried ${candidates.join(', ')})`);
}

function firstExistingFile(candidates, label) {
  for (const file of candidates) {
    if (existsSync(file)) return file;
  }
  throw new Error(`${label} not found (tried ${candidates.join(', ')})`);
}

export function identityValidDir() {
  return firstExisting([
    join(TEST_DIR, '../fixtures/contracts/flow-identity/valid'),
    join(TEST_DIR, '../../../contracts/flow-identity/fixtures/valid'),
  ], 'identity valid fixtures');
}

export function identityInvalidDir() {
  return firstExisting([
    join(TEST_DIR, '../fixtures/contracts/flow-identity/invalid'),
    join(TEST_DIR, '../../../contracts/flow-identity/fixtures/invalid'),
  ], 'identity invalid fixtures');
}

export function deliveryValidDir() {
  return firstExisting([
    join(TEST_DIR, '../fixtures/contracts/delivery/valid'),
    join(TEST_DIR, '../../../contracts/delivery/fixtures/valid'),
  ], 'delivery valid fixtures');
}

export function deliveryValidFile(name) {
  return firstExistingFile([
    join(TEST_DIR, '../fixtures/contracts/delivery/valid', name),
    join(TEST_DIR, '../../../contracts/delivery/fixtures/valid', name),
  ], `delivery fixture ${name}`);
}
