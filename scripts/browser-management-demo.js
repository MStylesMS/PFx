#!/usr/bin/env node

/**
 * Browser Management Demo
 *
 * As of PFx 2.1.0 the browser is auto-enabled at zone startup when
 * browser_url is set in pfx.ini. Use showBrowser/hideBrowser/setBrowserUrl.
 * Commands enableBrowser, disableBrowser, verifyBrowser are removed.
 */

var cmds = [
  {step:1, description:"Show browser", cmd:{command:"showBrowser"}},
  {step:2, description:"Hide browser", cmd:{command:"hideBrowser"}},
  {step:3, description:"Change URL", cmd:{command:"setBrowserUrl",url:"http://localhost/clock/"}},
];

cmds.forEach(function(c){
  console.log("Step "+c.step+": "+c.description);
  console.log(JSON.stringify(c.cmd));
  console.log("");
});

console.log("See docs/MQTT_API.md and docs/CONFIG_INI.md for details.");