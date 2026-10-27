import { afterAll, beforeEach } from 'vitest';
import { closeConnections, resetFixtures } from './helpers.ts';

// Shared hosted DB: every test starts from the seed state.
beforeEach(resetFixtures);
afterAll(closeConnections);
