/**
 * Input Zone
 *
 * Receives external input events (for example Shelly Plus i4) and publishes
 * normalized state/events. Optional input_map can dispatch mapped MQTT commands.
 */

const BaseZone = require('./base-zone');

class InputZone extends BaseZone {
    constructor(config, mqttClient, zoneManager) {
        super(config, mqttClient);
        this.zoneManager = zoneManager;
        this.inputTopics = this._normalizeInputTopics(config);
        this.inputMap = config.inputMap || {};
        this._handlers = [];

        this.currentState = {
            ...this.currentState,
            backend: config.backend || 'generic',
            profile: config.profile || 'input',
            lastInputEvent: null,
            matchedRule: null
        };
    }

    async initialize() {
        if (!this.inputTopics.length) {
            throw new Error(`Input zone '${this.config.name}' requires input_topic or input_topics`);
        }

        this.inputTopics.forEach((topic) => {
            const handler = async (_topic, message) => {
                await this._handleInboundInput(topic, message);
            };
            this.mqttClient.subscribe(topic, handler);
            this._handlers.push({ topic, handler });
        });

        this.isInitialized = true;
        this.currentState.status = 'ready';
        this.publishStatus();
        this._startPeriodicStatus();
    }

    async handleCommand(command) {
        const commandName = command.command || command.Command;
        if (commandName === 'getStatus' || commandName === 'getState') {
            this.publishStatus();
            return;
        }

        this._handleUnsupportedCommand(commandName);
    }

    getSupportedCommands() {
        return ['getStatus', 'getState'];
    }

    async shutdown() {
        this._stopPeriodicStatus();
        for (const entry of this._handlers) {
            this.mqttClient.unsubscribe(entry.topic);
        }
        this._handlers = [];
        this.currentState.status = 'offline';
        this.isInitialized = false;
        this.publishStatus();
    }

    async _handleInboundInput(sourceTopic, message) {
        const normalized = this._normalizeInputEvent(sourceTopic, message);
        this.currentState.lastInputEvent = normalized;
        this.currentState.matchedRule = null;

        this.publishEvent({
            source_topic: sourceTopic,
            input_event: normalized
        });
        this.publishStatus();

        const ruleKey = `${normalized.input}.${normalized.event}`;
        const mapped = this.inputMap[ruleKey] || this.inputMap[normalized.event] || null;
        if (mapped) {
            await this._dispatchMappedAction(ruleKey, mapped, normalized);
        }
    }

    _normalizeInputEvent(sourceTopic, message) {
        // Shelly Gen2 RPC event style
        if (message && typeof message === 'object' && message.method === 'NotifyEvent' && message.params && Array.isArray(message.params.events)) {
            const ev = message.params.events[0] || {};
            const component = (ev.component || 'input:0').toString();
            const inputIndex = component.includes(':') ? component.split(':')[1] : '0';
            return {
                input: inputIndex,
                event: ev.event || 'unknown',
                ts: ev.ts || Date.now(),
                source: 'shelly-rpc',
                raw: message
            };
        }

        // Generic payload styles
        if (message && typeof message === 'object') {
            return {
                input: `${message.input ?? message.channel ?? 0}`,
                event: message.event || message.action || message.type || 'unknown',
                ts: message.ts || Date.now(),
                source: message.source || 'json',
                raw: message
            };
        }

        // Raw/string fallback
        return {
            input: '0',
            event: typeof message === 'string' ? message : 'unknown',
            ts: Date.now(),
            source: 'raw',
            raw: message
        };
    }

    async _dispatchMappedAction(ruleKey, mapped, normalizedEvent) {
        const actions = Array.isArray(mapped) ? mapped : [mapped];

        for (const action of actions) {
            if (!action || !action.topic || !action.payload) {
                this.publishWarning(`Input map rule '${ruleKey}' has invalid action`, { rule: action });
                continue;
            }

            const payload = {
                ...action.payload,
                _input_event: {
                    input: normalizedEvent.input,
                    event: normalizedEvent.event,
                    ts: normalizedEvent.ts
                }
            };

            this.mqttClient.publish(action.topic, payload);
            this.currentState.matchedRule = ruleKey;
            this.publishEvent({
                mapped_rule: ruleKey,
                mapped_topic: action.topic,
                mapped_payload: payload
            });
        }
    }

    _normalizeInputTopics(config) {
        const topics = [];

        if (typeof config.inputTopic === 'string' && config.inputTopic.trim()) {
            topics.push(config.inputTopic.trim());
        }

        if (Array.isArray(config.inputTopics)) {
            config.inputTopics.forEach((topic) => {
                if (typeof topic === 'string' && topic.trim()) {
                    topics.push(topic.trim());
                }
            });
        }

        return Array.from(new Set(topics));
    }

    _extendStatusPayload(payload) {
        payload.input = {
            backend: this.config.backend || 'generic',
            profile: this.config.profile || 'input',
            subscribed_topics: this.inputTopics,
            last_event: this.currentState.lastInputEvent,
            matched_rule: this.currentState.matchedRule
        };
    }
}

module.exports = InputZone;
