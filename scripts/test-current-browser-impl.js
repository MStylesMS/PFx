#!/usr/bin/env node

/**
 * Test Browser Implementation
 *
 * As of PFx 2.1.0 the browser is auto-enabled at zone startup when
 * browser_url is set in pfx.ini. Use showBrowser/hideBrowser/setBrowserUrl.
 * Commands enableBrowser, disableBrowser, verifyBrowser are removed.
 */

console.log("PFx Browser Overlay Test Commands");
console.log("====================================");
console.log("");
console.log("The browser is auto-enabled via browser_url in pfx.ini.");
console.log("");

var steps = [
  {n:1, desc:"Show browser", m:"{\"command\":\"showBrowser\"}"},
  {n:2, desc:"Hide browser", m:"{\"command\":\"hideBrowser\"}"},
  {n:3, desc:"Show browser again", m:"{\"command\":\"showBrowser\"}"},
  {n:4, desc:"Hide browser", m:"{\"command\":\"hideBrowser\"}"},
];

steps.forEach(function(s){
  console.log("Step "+s.n+": "+s.desc);
  console.log("mosquitto_pub -h localhost -t paradox/zone2/commands -m "+JSON.stringify(s.m));
  console.log("");
});