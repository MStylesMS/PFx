const { Driver } = require('zwave-js');
const { once } = require('node:events');
const mqtt = require('mqtt');

const port = '/dev/serial/by-id/usb-Silicon_Labs_HubZ_Smart_Home_Controller_516000D0-if00-port0';
const nodeId = 3;
const publishTopic = 'paradox/houdini/zwave/front-door/events';

const driver = new Driver(port, { securityKeys: {}, interview: { queryAllUserCodes: false } });
const mq = mqtt.connect('mqtt://127.0.0.1:1883');

function publish(evt, raw = null) {
  const payload = { input: '0', event: evt, source: 'zwave-node-3', ts: Date.now() };
  if (raw) payload.raw = raw;
  const json = JSON.stringify(payload);
  mq.publish(publishTopic, json);
  console.log('PUBLISHED', json);
}

(async () => {
  try {
    await new Promise((res, rej) => {
      mq.once('connect', res);
      mq.once('error', rej);
    });
    console.log('MQTT_CONNECTED');

    await driver.start();
    await once(driver, 'driver ready');
    const node = driver.controller.nodes.get(nodeId);
    if (!node) throw new Error('Node 3 not found');
    console.log('ZWAVE_READY node=3');

    node.on('notification', (args) => {
      const text = `${args?.label || ''} ${args?.eventLabel || args?.event || ''}`.toLowerCase();
      if (text.includes('open')) return publish('open', { text });
      if (text.includes('closed') || text.includes('close')) return publish('closed', { text });
      publish('unknown', { text });
    });

    node.on('value updated', (args) => {
      const v = String(args?.newValue ?? '').toLowerCase();
      if (v === 'true' || v === 'open' || v === '22') return publish('open', { value: args?.newValue });
      if (v === 'false' || v === 'closed' || v === '23') return publish('closed', { value: args?.newValue });
    });

    setInterval(() => {}, 1000);
  } catch (e) {
    console.error('BRIDGE_ERROR', e.message);
    try { await driver.destroy(); } catch {}
    try { mq.end(true); } catch {}
    process.exit(1);
  }
})();
