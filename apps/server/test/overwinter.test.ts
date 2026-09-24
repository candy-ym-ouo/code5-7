import type { WorldSnapshot } from '@shanhai/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { Store } from '../src/db/store.ts';
import { GameService } from '../src/services/game-service.ts';

interface CommandResult {
  event: { type: string; message: string; effects: string[]; payload: Record<string, unknown> };
  world: WorldSnapshot;
}

const FIXED_SEED = 'fixed-replay-seed-0123456789abcdef';

function createService(databasePath: string): { service: GameService; store: Store; sessionId: string } {
  const store = new Store(databasePath);
  const service = new GameService(store);
  const sessionId = service.createSession('test-token-hash');
  service.createSave(sessionId);
  // 用固定种子替换随机种子，并清掉随机初始化的状态后重新生成
  store.db.prepare('UPDATE saves SET seed = ? WHERE session_id = ?').run(FIXED_SEED, sessionId);
  const save = service.findSaveBySession(sessionId)!;
  store.db.prepare('DELETE FROM site_states WHERE save_id = ?').run(save.id);
  store.db.prepare('DELETE FROM species_states WHERE save_id = ?').run(save.id);
  const internals = service as unknown as {
    initializeYear(save: ReturnType<GameService['findSaveBySession']>): void;
    updateSave(save: ReturnType<GameService['findSaveBySession']>): void;
  };
  internals.initializeYear(save);
  internals.updateSave(save);
  return { service, store, sessionId };
}

interface PersistedRow {
  year: number;
  site_id?: string;
  species_id?: string;
  [key: string]: unknown;
}

function dumpYear(store: Store, saveId: string, year: number) {
  const sites = store.db
    .prepare('SELECT * FROM site_states WHERE save_id = ? AND year = ? ORDER BY site_id')
    .all(saveId, year) as unknown as PersistedRow[];
  const species = store.db
    .prepare('SELECT * FROM species_states WHERE save_id = ? AND year = ? ORDER BY site_id, species_id')
    .all(saveId, year) as unknown as PersistedRow[];
  return { sites, species };
}

/** 去掉 save_id 列：它是随机档案 ID，不参与种子派生，跨存档比较时应忽略 */
function seedDerived(dump: ReturnType<typeof dumpYear>) {
  return {
    sites: dump.sites.map(({ save_id, ...rest }) => rest),
    species: dump.species.map(({ save_id, ...rest }) => rest)
  };
}

function waitCommand(expectedRevision: number) {
  return {
    expectedRevision,
    idempotencyKey: `wait-${expectedRevision}-${Math.random().toString(16).slice(2)}`,
    command: { type: 'WAIT' as const }
  };
}

function endSeasonCommand(expectedRevision: number) {
  return {
    expectedRevision,
    idempotencyKey: `end-${expectedRevision}-${Math.random().toString(16).slice(2)}`,
    command: { type: 'END_SEASON' as const }
  };
}

function nextSeasonCommand(expectedRevision: number) {
  return {
    expectedRevision,
    idempotencyKey: `next-season-${expectedRevision}-${Math.random().toString(16).slice(2)}`,
    command: { type: 'BEGIN_NEXT_SEASON' as const }
  };
}

function nextYearCommand(expectedRevision: number) {
  return {
    expectedRevision,
    idempotencyKey: `next-year-${expectedRevision}-${Math.random().toString(16).slice(2)}`,
    command: { type: 'BEGIN_NEXT_YEAR' as const }
  };
}

function advanceThroughYearOne(service: GameService, sessionId: string, saveId: string, startRevision: number): number {
  let revision = startRevision;
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    for (let index = 0; index < 21; index += 1) {
      service.executeCommand(sessionId, saveId, waitCommand(revision));
      revision += 1;
    }
    service.executeCommand(sessionId, saveId, endSeasonCommand(revision));
    revision += 1;
    if (season !== 'winter') {
      service.executeCommand(sessionId, saveId, nextSeasonCommand(revision));
      revision += 1;
    }
  }
  return revision;
}

describe('overwinter determinism and historical state preservation', () => {
  let appStore: ReturnType<typeof createApp>['store'];

  beforeAll(() => {
    appStore = createApp({ databasePath: ':memory:', loggerEnabled: false }).store;
  });

  afterAll(() => appStore.close());

  it('produces identical year-2 states from the same seed across independent saves', () => {
    const runA = createService(':memory:');
    const runB = createService(':memory:');

    try {
      const saveA = runA.service.findSaveBySession(runA.sessionId)!;
      const saveB = runB.service.findSaveBySession(runB.sessionId)!;
      const revisionA = advanceThroughYearOne(runA.service, runA.sessionId, saveA.id, saveA.revision);
      const revisionB = advanceThroughYearOne(runB.service, runB.sessionId, saveB.id, saveB.revision);

      const transitionA = runA.service.executeCommand(runA.sessionId, saveA.id, nextYearCommand(revisionA)) as unknown as CommandResult;
      const transitionB = runB.service.executeCommand(runB.sessionId, saveB.id, nextYearCommand(revisionB)) as unknown as CommandResult;

      expect(transitionA.event.payload).toEqual(transitionB.event.payload);

      const yearTwoA = dumpYear(runA.store, saveA.id, 2);
      const yearTwoB = dumpYear(runB.store, saveB.id, 2);
      expect(seedDerived(yearTwoA)).toEqual(seedDerived(yearTwoB));
    } finally {
      runA.store.close();
      runB.store.close();
    }
  });

  it('does not overwrite prior-year site and species rows when entering the next year', () => {
    const run = createService(':memory:');
    try {
      const save = run.service.findSaveBySession(run.sessionId)!;
      const revision = advanceThroughYearOne(run.service, run.sessionId, save.id, save.revision);

      const yearOneBefore = dumpYear(run.store, save.id, 1);
      expect(yearOneBefore.sites.length).toBe(4);
      expect(yearOneBefore.species.length).toBeGreaterThan(0);

      const transition = run.service.executeCommand(run.sessionId, save.id, nextYearCommand(revision)) as unknown as CommandResult;
      expect(transition.world.year).toBe(2);

      const yearOneAfter = dumpYear(run.store, save.id, 1);
      expect(yearOneAfter).toEqual(yearOneBefore);

      // 第二年游玩期间的季节演化本来就会更新第二年的行；关键是进入第三年的
      // 跨年结算只能写入第三年，不能回写第二年（更不能动第一年）
      const saveAfter = run.service.findSaveBySession(run.sessionId)!;
      const revision2 = advanceThroughYearOne(run.service, run.sessionId, save.id, saveAfter.revision);
      const yearTwoBeforeTransition = dumpYear(run.store, save.id, 2);
      run.service.executeCommand(run.sessionId, save.id, nextYearCommand(revision2));

      expect(dumpYear(run.store, save.id, 1)).toEqual(yearOneBefore);
      expect(dumpYear(run.store, save.id, 2)).toEqual(yearTwoBeforeTransition);

      const yearThree = dumpYear(run.store, save.id, 3);
      expect(yearThree.sites.length).toBe(4);
      expect(yearThree.species.length).toBe(yearTwoBeforeTransition.species.length);
    } finally {
      run.store.close();
    }
  });
});
