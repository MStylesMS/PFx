const Logger = require('../../utils/logger');

class MultiTargetBackend {
    constructor(config, targets = []) {
        this.config = config;
        this.targets = targets;
        this.logger = new Logger(`MultiTargetBackend:${config.name}`);
    }

    async initialize() {
        for (const target of this.targets) {
            await target.backend.initialize();
        }
        this.logger.info(`Initialized ${this.targets.length} lighting targets`);
    }

    async shutdown() {
        for (const target of this.targets) {
            if (target.backend && target.backend.shutdown) {
                await target.backend.shutdown();
            }
        }
    }

    async execute(commandName, payload = {}) {
        const settled = await Promise.allSettled(
            this.targets.map(async (target) => {
                const result = await target.backend.execute(commandName, payload);
                return { id: target.id, result };
            })
        );

        const successful = [];
        const failed = [];

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successful.push(result.value);
            } else {
                failed.push({
                    id: this.targets[index] ? this.targets[index].id : `target-${index + 1}`,
                    error: result.reason ? result.reason.message : 'Unknown error'
                });
            }
        });

        if (failed.length === this.targets.length) {
            const message = failed.map(f => `${f.id}: ${f.error}`).join('; ');
            throw new Error(`All lighting targets failed: ${message}`);
        }

        if (failed.length > 0) {
            return {
                applied: true,
                warning: `Partial group success (${successful.length}/${this.targets.length}). Failed: ${failed.map(f => f.id).join(', ')}`,
                failed,
                successful: successful.map(s => s.id)
            };
        }

        return {
            applied: true,
            successful: successful.map(s => s.id)
        };
    }
}

module.exports = MultiTargetBackend;
