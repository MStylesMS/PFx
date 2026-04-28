# PR_OVERLAYS: Real-Time Text Overlay System for PFx

## Overview

This pull request adds real-time text overlay capabilities to ParadoxFX, enabling dynamic display of information (countdowns, hints, status messages) over full-screen video content without interrupting playback.

## Key Features to Add

### 1. MPV Overlay Integration
- Leverage MPV's built-in OSD (On-Screen Display) system
- Utilize existing IPC infrastructure for real-time control
- Support for styled text with positioning, colors, and formatting
- Non-intrusive overlays that don't affect video playback performance

### 2. Screen Zone Overlay Methods
- Extend `ScreenZone` class with overlay management methods
- Support for persistent and temporary overlays
- Multiple overlay types: countdown timers, hints, status messages, alerts
- Overlay stacking and priority management

### 3. MQTT Command Interface
- New MQTT commands for overlay control
- Real-time overlay updates via existing MQTT infrastructure
- Support for overlay scheduling and automation
- Integration with existing PxO game engine for escape room scenarios

### 4. Overlay Types and Use Cases

#### **Countdown Timers**
- Real-time countdown display during video playback
- Configurable positioning (top-left, top-right, bottom-center, etc.)
- Multiple timer formats (MM:SS, HH:MM:SS, custom)
- Visual styling options (colors, fonts, sizes)

#### **Hint System**
- Dynamic hint text display over video content
- Timed hints with automatic fadeout
- Priority-based hint queuing
- Integration with Agent22 hint delivery system

#### **Status Messages**
- System status overlays (connection status, errors, warnings)
- Player feedback messages
- Progress indicators
- Achievement notifications

#### **Interactive Elements**
- Button prompts and instructions
- Menu overlays for user interaction
- Progress bars and loading indicators
- Dynamic content based on game state

### 5. Configuration and Styling

#### **Text Formatting**
- ASS (Advanced SubStation Alpha) subtitle formatting support for rich text styling
- Font family, size, weight, and style controls (any system font)
- Full RGB color control with transparency/alpha channel (16.7 million colors)
- Independent control of text color, outline color, shadow color, and background color
- Shadow and outline effects for visibility
- Drop shadows with offset and blur control
- Outlines/borders with thickness control
- Bold, italic, underline, and strikeout text styles
- Font scaling and spacing adjustments
- Blur effects for soft shadows and glows

#### **Positioning System**
- Predefined anchor points (9-point grid system: corners, edges, center)
- Custom pixel-perfect positioning (absolute X/Y coordinates)
- Relative positioning based on screen dimensions
- Margin and padding control
- Rotation support for angled text
- Multi-monitor support with per-screen positioning

#### **Animation Support**
- Fade in/out transitions with timing control
- Slide animations for dynamic content (move from point A to B)
- Scale animations for zoom effects
- Pulsing effects for attention-grabbing elements
- Smooth text updates without flicker
- Coordinated multi-element animations

### 6. Integration Points

#### **Existing PFx Components**
- `MpvZoneManager` - Core IPC command routing
- `ScreenZone` - Primary overlay management interface
- MQTT API - External control and automation
- Configuration system - Overlay defaults and styling

#### **PxO Game Engine Integration**
- Game state-driven overlays
- Countdown synchronization with game timers
- Hint delivery coordination
- Event-triggered overlay updates

#### **Agent22 Specific Features**
- Escape room countdown integration
- Multi-stage hint system
- Progress tracking overlays
- Team coordination messages

## Technical Implementation Areas

### 1. Core Overlay Manager
- Central overlay state management
- Overlay lifecycle (create, update, remove)
- Conflict resolution for overlapping content
- Performance optimization for real-time updates

### 2. MPV Command Extensions
- New IPC command wrappers for overlay operations
- Error handling and fallback mechanisms
- Command queuing for rapid updates
- Compatibility across MPV versions

### 3. MQTT API Extensions
- Overlay command schema definitions
- JSON validation for overlay parameters
- Event publishing for overlay state changes
- Integration with existing MQTT topic structure

### 4. Configuration Schema
- INI configuration for default overlay settings
- Per-zone overlay customization
- Style template system
- Runtime configuration updates

## Benefits and Use Cases

### **Escape Room Applications**
- Real-time countdown without separate display hardware
- Context-sensitive hints overlaid on thematic video content
- Progress tracking and team communication
- Immersive information display within themed environments

### **Multi-Zone Deployments**
- Consistent information display across multiple screens
- Centralized overlay management via MQTT
- Zone-specific overlay customization
- Coordinated multi-screen experiences

### **Performance and Reliability**
- Minimal impact on video playback performance
- Graceful degradation if overlay system fails
- Real-time responsiveness for time-critical applications
- Compatibility with existing PFx deployment patterns

## Future Enhancements

### **Advanced Features**
- Image overlay support (limited to external subtitle tracks with embedded images)
- Icon support via Unicode characters and emoji (✓ ✗ ⚠ ⏰ 🔑 💡)
- Advanced image overlays using separate video layers or SVG-to-video conversion
- Dynamic content from external data sources
- Overlay templates and themes
- User interaction with overlay elements

### **Styling Capabilities Summary**

| Feature | Support Level | Implementation |
|---------|---------------|----------------|
| **Text Colors** | ✅ Full | RGB + transparency via ASS formatting |
| **Fonts** | ✅ Full | Any system font with size control |
| **Bold/Italic/Underline** | ✅ Full | All standard text styles |
| **Drop Shadows** | ✅ Full | Offset, blur, and color control |
| **Outlines/Borders** | ✅ Full | Thickness and color control |
| **Positioning** | ✅ Full | Pixel-perfect + 9-point alignment grid |
| **Transparency** | ✅ Full | Per-element alpha channel |
| **Animations** | ✅ Full | Move, fade, scale with timing |
| **Images/Icons** | ⚠️ Limited | Unicode/emoji for text; external tracks for complex images |
| **Rotation** | ✅ Full | Text rotation support |

### **ASS Formatting Examples**

```javascript
// Styled countdown with shadow and outline
{\\an8\\fs60\\b1\\c&H00FFFF&\\3c&H000000&\\bord3\\shad2}TIME REMAINING: 05:32

// Multi-colored hint with effects
{\\an3\\fs50\\fnImpact\\c&HFFFF00&\\bord4\\shad3\\blur1}⚠ HINT
{\\fs35\\fnArial\\c&HFFFFFF&\\bord2\\shad2}Look behind the mirror

// Animated text movement
{\\move(0,0,100,100,0,1000)}Moving Text

// Transparent background with solid text
{\\1a&H80&\\c&HFFFFFF&}50% Transparent Text
```

**ASS Format Tags Reference:**
- `\\c&HBBGGRR&` - Primary text color (BGR hex)
- `\\3c&HBBGGRR&` - Outline/border color
- `\\4c&HBBGGRR&` - Shadow color
- `\\1a&HXX&` - Text transparency (00=opaque, FF=invisible)
- `\\fs##` - Font size in pixels
- `\\fn<name>` - Font name
- `\\b1` - Bold (\\b0 to disable)
- `\\i1` - Italic (\\i0 to disable)
- `\\u1` - Underline (\\u0 to disable)
- `\\bord#` - Border/outline thickness
- `\\shad#` - Shadow offset distance
- `\\blur#` - Gaussian blur radius
- `\\an#` - Alignment (1-9: 1=bottom-left, 5=center, 9=top-right)
- `\\pos(x,y)` - Absolute position
- `\\move(x1,y1,x2,y2,t1,t2)` - Animate position over time
- `\\fscx##\\fscy##` - Font scale (X and Y percentage)

### **Integration Expansions**
- Web-based overlay editor interface
- Database-driven content management
- Third-party system integration (scoreboards, APIs)
- Mobile device overlay control

## Success Criteria

1. **Performance**: Overlays add <5ms latency to video playback
2. **Reliability**: Overlay failures don't affect core video functionality
3. **Usability**: Simple MQTT commands for common overlay operations
4. **Flexibility**: Support for diverse overlay types and styling needs
5. **Integration**: Seamless integration with existing PFx and PxO systems

## Development Timeline

- **Phase 1**: Core MPV overlay integration and basic text display
- **Phase 2**: MQTT command interface and ScreenZone extensions
- **Phase 3**: Advanced styling, positioning, and animation support
- **Phase 4**: PxO integration and Agent22-specific features
- **Phase 5**: Performance optimization and documentation

---

*This document outlines the high-level plan for overlay functionality. Detailed implementation specifications, API designs, and technical architecture will be refined in subsequent planning documents.*