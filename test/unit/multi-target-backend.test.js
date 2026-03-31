/**
 * Unit Tests for MultiTargetBackend — warning propagation and failure handling.
 */

const MultiTargetBackend = require('../../lib/lights/backends/multi-target-backend');

// Build a fake target backed by a mock backend.
function makeTarget(id, { warning = null, throws = null } = {}) {
    return {
        id,
        backend: {
            initialize: jest.fn().mockResolvedValue(undefined),
            shutdown:   jest.fn().mockResolvedValue(undefined),
            execute: jest.fn().mockImplementation(() => {
                if (throws) return Promise.reject(new Error(throws));
                const result = { applied: true };
                if (warning) result.warning = warning;
                return Promise.resolve(result);
            })
        }
    };
}

const BASE_CONFIG = { name: 'test-group' };

// ─── all targets succeed with no warnings ────────────────────────────────────

describe('MultiTargetBackend — clean success', () => {
    it('returns applied:true and lists all successful ids', async () => {
        const backend = new MultiTargetBackend(BASE_CONFIG, [
            makeTarget('wiz-1'),
            makeTarget('hue-1')
        ]);
        const result = await backend.execute('on');
        expect(result.applied).toBe(true);
        expect(result.warning).toBeUndefined();
        expect(result.successful).toEqual(['wiz-1', 'hue-1']);
    });
});

// ─── per-target backend degradation warnings ─────────────────────────────────

describe('MultiTargetBackend — per-target warnings', () => {
    it('surfaces a single degraded-target warning', async () => {
        const backend = new MultiTargetBackend(BASE_CONFIG, [
            makeTarget('wiz-1'),
            makeTarget('lifx-1', { warning: "Unknown scene 'disco'; sent on only" })
        ]);
        const result = await backend.execute('scene', { scene: 'disco' });
        expect(result.applied).toBe(true);
        expect(result.warning).toMatch(/Degraded/);
        expect(result.warning).toMatch(/lifx-1/);
        expect(result.warning).toMatch(/Unknown scene 'disco'/);
        expect(result.successful).toContain('wiz-1');
        expect(result.successful).toContain('lifx-1');
    });

    it('includes all degraded targets in warned array', async () => {
        const backend = new MultiTargetBackend(BASE_CONFIG, [
            makeTarget('hue-1', { warning: 'Profile dim: color ignored' }),
            makeTarget('shelly-1', { warning: "Unknown scene 'disco'; sent on only" })
        ]);
        const result = await backend.execute('scene', { scene: 'disco' });
        expect(result.warned).toHaveLength(2);
        expect(result.warned.map(w => w.id)).toEqual(expect.arrayContaining(['hue-1', 'shelly-1']));
    });

    it('does not set failed when all targets succeed (even with warnings)', async () => {
        const backend = new MultiTargetBackend(BASE_CONFIG, [
            makeTarget('lifx-1', { warning: 'some degradation' })
        ]);
        const result = await backend.execute('scene', { scene: 'mystery' });
        expect(result.failed).toBeUndefined();
        expect(result.warned).toHaveLength(1);
    });
});

// ─── hard failures ────────────────────────────────────────────────────────────

describe('MultiTargetBackend — hard failures', () => {
    it('returns warning for partial failure', async () => {
        const backend = new MultiTargetBackend(BASE_CONFIG, [
            makeTarget('wiz-1'),
            makeTarget('broken', { throws: 'ENETUNREACH' })
        ]);
        const result = await backend.execute('on');
        expect(result.applied).toBe(true);
        expect(result.warning).toMatch(/Partial group success/);
        expect(result.warning).toMatch(/broken/);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].id).toBe('broken');
    });

    it('throws when all targets fail', async () => {
        const backend = new MultiTargetBackend(BASE_CONFIG, [
            makeTarget('a', { throws: 'err-a' }),
            makeTarget('b', { throws: 'err-b' })
        ]);
        await expect(backend.execute('on')).rejects.toThrow(/All lighting targets failed/);
    });
});

// ─── combined: failures + per-target warnings ────────────────────────────────

describe('MultiTargetBackend — combined failures and warnings', () => {
    it('joins both partial-failure and degradation messages', async () => {
        const backend = new MultiTargetBackend(BASE_CONFIG, [
            makeTarget('wiz-1', { warning: "Unknown scene 'x'; sent on only" }),
            makeTarget('broken', { throws: 'ENETUNREACH' })
        ]);
        const result = await backend.execute('scene', { scene: 'x' });
        expect(result.applied).toBe(true);
        expect(result.warning).toMatch(/Partial group success/);
        expect(result.warning).toMatch(/Degraded/);
        expect(result.failed).toHaveLength(1);
        expect(result.warned).toHaveLength(1);
    });
});

// ─── initialize / shutdown ────────────────────────────────────────────────────

describe('MultiTargetBackend — lifecycle', () => {
    it('initializes all target backends', async () => {
        const t1 = makeTarget('a');
        const t2 = makeTarget('b');
        const backend = new MultiTargetBackend(BASE_CONFIG, [t1, t2]);
        await backend.initialize();
        expect(t1.backend.initialize).toHaveBeenCalled();
        expect(t2.backend.initialize).toHaveBeenCalled();
    });

    it('shuts down all target backends', async () => {
        const t1 = makeTarget('a');
        const t2 = makeTarget('b');
        const backend = new MultiTargetBackend(BASE_CONFIG, [t1, t2]);
        await backend.shutdown();
        expect(t1.backend.shutdown).toHaveBeenCalled();
        expect(t2.backend.shutdown).toHaveBeenCalled();
    });
});
