# Hexagon Coloring System

## Overview

The board uses a **state-based coloring system** where each hexagon's displayed color is determined by:
1. **Base color** (determined by coordinates) - black (`b`), gray (`g`), or white (`w`)
2. **State** - `default`, `selectable`, or `interactable`

The final color is computed by looking up the base color and state in a color configuration file.

## Base Color Determination

Each hexagon has a base color determined by its coordinates `(x, y)` using the formula:

```
colorIndex = ((2 * x - y) % 3 + 3) % 3
```

The mapping is:
- `colorIndex === 0` → gray (`g`)
- `colorIndex === 1` → black (`b`)
- `colorIndex === 2` → white (`w`)

This ensures a 3-coloring of the hex grid where no two adjacent hexagons share the same base color.

**Reference points:**
- `(0, 0)` → gray
- `(1, 1)` → black
- `(-1, -1)` → white

## Hexagon States

### `default`
The default state for all hexagons. Used when the hexagon is not selectable or being interacted with.

### `selectable`
A hexagon is in the `selectable` state when:
- It is the active player's turn
- The hexagon contains a unit that can legally move
- The hexagon is not currently being hovered

### `interactable`
A hexagon is in the `interactable` state when:
- It is in the `selectable` state
- The mouse is hovering over it

## Color Configuration

Colors are defined in `apps/web/src/colors.json` with the following structure:

```json
{
  "states": {
    "default": {
      "b": "#2A2A2A",
      "g": "#4A4A4A",
      "w": "#737373"
    },
    "selectable": {
      "b": "#553600",
      "g": "#946000",
      "w": "#E7AF00"
    },
    "interactable": {
      "b": "#350058",
      "g": "#5F0098",
      "w": "#AE00EE"
    }
  }
}
```

Each state defines colors for all three base colors (`b`, `g`, `w`).

## Implementation

### Utility Functions

The coloring system is implemented in `apps/web/src/hexagonColors.ts`:

- `getBaseColor(x: number, y: number): HexagonBaseColor`
  - Determines the base color from coordinates
  
- `getHexagonColor(baseColor: HexagonBaseColor, state: HexagonState = 'default'): string`
  - Returns the hex color string for a given base color and state

### Usage in Components

In `Game.tsx`, the coloring system is used as follows:

```typescript
// Determine base color from coordinates
const baseColor = getBaseColor(x, y);

// Determine state based on game logic
let hexagonState: HexagonState = 'default';
if (hoveredCid === cid && isActive && isLegal && unit) {
  hexagonState = 'interactable';
} else if (isActive && isLegal && unit) {
  hexagonState = 'selectable';
}

// Get the final color
const tileColor = getHexagonColor(baseColor, hexagonState);
```

## Extending the System

To add new states:

1. Add the state definition to `colors.json`:
```json
{
  "states": {
    "newState": {
      "b": "#HEX_COLOR",
      "g": "#HEX_COLOR",
      "w": "#HEX_COLOR"
    }
  }
}
```

2. Update the `HexagonState` type in `hexagonColors.ts`:
```typescript
export type HexagonState = 'default' | 'selectable' | 'interactable' | 'newState';
```

3. Add logic in the component to set hexagons to the new state when appropriate.

## Color Selection Guidelines

When choosing colors for new states:

- **Contrast**: Ensure sufficient contrast between states for accessibility
- **Consistency**: Maintain visual consistency with existing states
- **Base color awareness**: Each state must define colors for all three base colors (`b`, `g`, `w`)
- **User feedback**: Use color to provide clear visual feedback about hexagon interactivity
