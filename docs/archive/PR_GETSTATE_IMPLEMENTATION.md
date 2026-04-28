# PFX Implementation PR - Add Missing getState Command

## Overview
Implement the missing `getState` command in ParadoxFX to match the documented API and enable on-demand state requests from client applications.

## Problem Statement
- **Documentation Gap**: `getState` command is listed in README_FULL.md as a supported command
- **Implementation Missing**: PFX currently responds with "Unknown command: getState" 
- **Client Impact**: Orchestrator applications cannot request immediate state updates, causing timing issues during startup

## Evidence from Logs
```
2025-08-29T00:18:57.021Z [ERROR] ScreenZone:mirror    Command failed: getState {
  "error": "Unknown command: getState",
  "command": "getState"
}
```

## Solution
Add `getState` command handler to immediately publish current zone state when requested.

## Implementation Details

### 1. Update ScreenZone Command Handler
**File**: `lib/zones/ScreenZone.js`

Add `getState` case to the command switch statement:

```javascript
case 'getState':
    this.publishStatus();
    return { success: true, message: 'State published' };
```

### 2. Update AudioZone Command Handler  
**File**: `lib/zones/AudioZone.js`

Add `getState` case to the command switch statement:

```javascript
case 'getState':
    this.publishStatus();
    return { success: true, message: 'State published' };
```

### 3. Command Behavior
- **Trigger**: Immediate state publish to zone's state topic
- **Response**: Success confirmation to command topic
- **State Content**: Same format as automatic periodic state publishing
- **No Parameters**: Command takes no additional parameters

### 4. MQTT Flow
```
Client → paradox/{zone}/commands → {"command":"getState"}
PFX   → paradox/{zone}/state     → {current zone state}
```

## Testing Requirements

### 1. Unit Tests
- Add test cases for `getState` command in existing zone test files
- Verify `publishStatus()` is called when command received
- Verify success response is returned

### 2. Integration Tests
- Test `getState` command via MQTT on running PFX instance
- Verify state message is published immediately
- Test on both screen and audio zones

### 3. Manual Testing Commands
```bash
# Test screen zone
mosquitto_pub -h localhost -t "paradox/houdini/mirror/commands" -m '{"command":"getState"}'
mosquitto_sub -h localhost -t "paradox/houdini/mirror/state" -C 1 -v

# Test audio zone  
mosquitto_pub -h localhost -t "paradox/zone1/commands" -m '{"command":"getState"}'
mosquitto_sub -h localhost -t "paradox/zone1/state" -C 1 -v
```

## Documentation Updates

### 1. Confirm Documentation Accuracy
- Verify `getState` is already documented in README_FULL.md (it is)
- Add example usage to MQTT_API.md if missing

### 2. Add getState to Command Examples
**File**: `README_FULL.md`

Add to command examples section:
```bash
# Request immediate state update
mosquitto_pub -t "paradox/houdini/mirror/commands" -m '{"command":"getState"}'
```

## Success Criteria
- [ ] `getState` command no longer returns "Unknown command" error
- [ ] State is immediately published when `getState` received
- [ ] Both screen and audio zones support the command
- [ ] Unit tests pass for new functionality
- [ ] Integration tests confirm MQTT behavior
- [ ] Documentation examples work as expected

## Related Issues
- Fixes orchestrator startup timing issues
- Matches documented API behavior
- Enables on-demand state inspection for debugging

## Files to Modify
- `lib/zones/ScreenZone.js` - Add getState command handler
- `lib/zones/AudioZone.js` - Add getState command handler  
- `test/zones/ScreenZone.test.js` - Add getState unit tests
- `test/zones/AudioZone.test.js` - Add getState unit tests
- `README_FULL.md` - Add getState example (if missing)

## Estimated Impact
- **Risk Level**: Low (simple command addition)
- **Breaking Changes**: None
- **Backward Compatibility**: Full
- **Performance Impact**: Minimal (on-demand state publish)

## Implementation Notes
- Use existing `publishStatus()` method for consistency
- No new dependencies required
- Command is stateless and side-effect free
- Follows existing PFX command pattern exactly
