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
        // Input zones are event-driven: publish retained state at startup and when new input arrives.
        this.periodicStatusEnabled = false;

        this.currentState = {
            ...this.currentState,
            backend: config.backend || 'generic',
            profile: config.profile || 'input',
            lastInputEvent: null,
            matchedRule: null,
            signals: {
                last_seen: null,
                contact: null,
                battery: null,
                tamper: null,
                reachable: null
            }
        };

        this.warningPolicy = {
            lowBatteryThreshold: Number.parseInt(config.lowBatteryThreshold || config.low_battery_threshold || 20, 10),
            offlineTimeoutSec: Number.parseInt(config.offlineTimeoutSec || config.offline_timeout_sec || 0, 10),
            tamperWarningEnabled: String(config.tamperWarningEnabled || config.tamper_warning_enabled || 'true').toLowerCase() !== 'false'
        };

        this._warningState = {
            lowBatteryActive: false,
            tamperActive: false
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
            this.logger.info(`Input zone '${this.config.name}' subscribed to ${topic}`);
        });

        this.isInitialized = true;
        this.currentState.status = 'ready';
        this.publishStatus();
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
        this.logger.info(`Input zone '${this.config.name}' received event: ${normalized.event} (source: ${normalized.source}) on ${sourceTopic}`);
        this.currentState.lastInputEvent = normalized;
        this.currentState.matchedRule = null;
        this._updateSignals(normalized);
        this._maybeEmitSignalWarnings();

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
                event: this._canonicalizeContactEvent(ev.event) || ev.event || 'unknown',
                ts: ev.ts || Date.now(),
                source: 'shelly-rpc',
                raw: message
            };
        }

        // Generic payload styles
        if (message && typeof message === 'object') {
            const nestedInputEvent = message.input_event && typeof message.input_event === 'object' ? message.input_event : null;
            const eventToken = this._extractEventToken(message, nestedInputEvent);
            return {
                input: `${message.input ?? message.channel ?? nestedInputEvent?.input ?? 0}`,
                event: eventToken || 'unknown',
                ts: message.ts || Date.now(),
                source: message.source || 'json',
                raw: message
            };
        }

        // Raw/string fallback
        const eventToken = this._canonicalizeContactEvent(message);
        return {
            input: '0',
            event: eventToken || (typeof message === 'string' ? message : 'unknown'),
            ts: Date.now(),
            source: 'raw',
            raw: message
        };
    }

    _extractEventToken(message, nestedInputEvent = null) {
        const candidates = [
            message.event,
            message.action,
            message.type,
            message.state,
            message.contact,
            message.eventLabel,
            nestedInputEvent?.event,
            nestedInputEvent?.action,
            nestedInputEvent?.type,
            nestedInputEvent?.state,
            nestedInputEvent?.contact
        ];

        for (const candidate of candidates) {
            const normalized = this._canonicalizeContactEvent(candidate);
            if (normalized) return normalized;
        }

        const valueCandidates = [
            message.value,
            message.newValue,
            message.currentValue,
            nestedInputEvent?.value,
            nestedInputEvent?.newValue,
            nestedInputEvent?.currentValue
        ];

        for (const valueCandidate of valueCandidates) {
            const normalized = this._canonicalizeContactEvent(valueCandidate);
            if (normalized) return normalized;
        }

        return null;
    }

    _isContactProfile() {
        const profile = String(this.config.profile || '').toLowerCase();
        const sensorType = String(this.config.zwaveSensorType || this.config.zwave_sensor_type || '').toLowerCase();
        return profile === 'contact' || sensorType === 'contact';
    }

    _canonicalizeContactEvent(value) {
        if (value === undefined || value === null) return null;

        if (typeof value === 'boolean') {
            return this._isContactProfile() ? (value ? 'open' : 'close') : (value ? 'true' : 'false');
        }

        if (typeof value === 'number') {
            if (this._isContactProfile()) {
                // Common Z-Wave contact values: 22=open, 23=closed.
                if (value === 22 || value === 1) return 'open';
                if (value === 23 || value === 0) return 'close';
            }
            return String(value);
        }

        if (typeof value !== 'string') return null;

        const token = value.trim().toLowerCase();
        if (!token) return null;

        const openTokens = ['open', 'opened', 'opening', 'active', 'on', 'true', '1', '22'];
        const closeTokens = ['close', 'closed', 'closing', 'inactive', 'off', 'false', '0', '23'];

        if (openTokens.includes(token)) return 'open';
        if (closeTokens.includes(token)) return 'close';

        return token;
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

    _toIsoTs(tsValue) {
        if (tsValue === undefined || tsValue === null) return new Date().toISOString();
        const n = Number(tsValue);
        if (Number.isFinite(n)) {
            // Heuristic: small values may be seconds, larger values likely milliseconds.
            const ms = n < 10_000_000_000 ? n * 1000 : n;
            return new Date(ms).toISOString();
        }
        return new Date().toISOString();
    }

    _updateSignals(normalizedEvent) {
        const ts = this._toIsoTs(normalizedEvent.ts);
        const signals = {
            ...this.currentState.signals,
            last_seen: ts,
            reachable: { value: true, ts }
        };

        const raw = normalizedEvent.raw && typeof normalizedEvent.raw === 'object' ? normalizedEvent.raw : {};
        const eventToken = String(normalizedEvent.event || '').trim().toLowerCase();
        if (['open', 'opened'].includes(eventToken)) {
            signals.contact = { value: 'open', ts };
        } else if (['close', 'closed'].includes(eventToken)) {
            signals.contact = { value: 'close', ts };
        }

        const batteryRaw = raw.battery ?? raw.battery_level ?? raw.batteryLevel;
        const batteryLevel = Number.parseFloat(batteryRaw);
        if (Number.isFinite(batteryLevel)) {
            signals.battery = { level: batteryLevel, ts };
        }

        const tamperRaw = raw.tamper ?? raw.tamper_active ?? raw.tamperActive;
        if (tamperRaw !== undefined) {
            const active = tamperRaw === true || tamperRaw === 'true' || tamperRaw === 1 || tamperRaw === '1' || tamperRaw === 'active';
            signals.tamper = { active, ts };
        }

        this.currentState.signals = signals;
    }

    _maybeEmitSignalWarnings() {
        const batteryLevel = this.currentState.signals?.battery?.level;
        if (Number.isFinite(batteryLevel)) {
            const lowBatteryNow = batteryLevel <= this.warningPolicy.lowBatteryThreshold;
            if (lowBatteryNow && !this._warningState.lowBatteryActive) {
                this.publishWarning('input_low_battery', {
                    warning_type: 'input_low_battery',
                    threshold: this.warningPolicy.lowBatteryThreshold,
                    level: batteryLevel
                });
            }
            this._warningState.lowBatteryActive = lowBatteryNow;
        }

        const tamperActive = this.currentState.signals?.tamper?.active === true;
        if (this.warningPolicy.tamperWarningEnabled) {
            if (tamperActive && !this._warningState.tamperActive) {
                this.publishWarning('input_tamper_active', {
                    warning_type: 'input_tamper_active'
                });
            }
            this._warningState.tamperActive = tamperActive;
        }
    }

    getSchemaMetadata() {
        return {
            state_fields: {
                status: 'string',
                input: {
                    backend: 'string',
                    profile: 'string',
                    subscribed_topics: 'string[]',
                    last_event: 'object|null',
                    matched_rule: 'string|null',
                    signals: {
                        last_seen: 'iso8601|null',
                        contact: '{ value: open|close, ts: iso8601 }|null',
                        battery: '{ level: number, ts: iso8601 }|null',
                        tamper: '{ active: boolean, ts: iso8601 }|null',
                        reachable: '{ value: boolean, ts: iso8601 }|null'
                    }
                },
                lastCommand: 'string|null',
                errors: 'array'
            },
            event_fields: {
                source_topic: 'string',
                input_event: {
                    input: 'string',
                    event: 'string',
                    ts: 'number',
                    source: 'string',
                    raw: 'object|primitive'
                }
            },
            warning_policy: {
                low_battery_threshold: this.warningPolicy.lowBatteryThreshold,
                offline_timeout_sec: this.warningPolicy.offlineTimeoutSec,
                tamper_warning_enabled: this.warningPolicy.tamperWarningEnabled,
                warning_types: ['input_low_battery', 'input_tamper_active']
            }
        };
    }

    publishStatus() {
        if (!this.mqttClient || !this.config.baseTopic) {
            return;
        }

        const payload = {
            status: this.currentState.status,
            lastCommand: this.currentState.lastCommand || null,
            errors: this.currentState.errors || [],
            input: {
                backend: this.config.backend || 'generic',
                profile: this.config.profile || 'input',
                subscribed_topics: this.inputTopics,
                last_event: this.currentState.lastInputEvent,
                matched_rule: this.currentState.matchedRule,
                signals: this.currentState.signals
            }
        };

        const message = {
            timestamp: new Date().toISOString(),
            zone: this.config.name,
            type: 'status',
            ...payload
        };

        this.mqttClient.publish(`${this.config.baseTopic}/state`, message, { retain: true });
        this.logger.debug('Published input status message:', message);
        return message;
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
