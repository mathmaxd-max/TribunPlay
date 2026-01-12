import colorsConfig from './colors.json';

export type HexagonBaseColor = 'b' | 'g' | 'w';
export type HexagonState = 'default' | 'selectable' | 'selected' | 'interactable';

interface ColorConfig {
  states: {
    [key in HexagonState]: {
      b: string;
      g: string;
      w: string;
    };
  };
}

const colorConfig = colorsConfig as ColorConfig;

/**
 * Get the color for a hexagon based on its base color and state
 * @param baseColor - The base color determined by coordinates ('b', 'g', or 'w')
 * @param state - The current state of the hexagon ('default', 'selectable', or 'interactable')
 * @returns The hex color string
 */
export function getHexagonColor(baseColor: HexagonBaseColor, state: HexagonState = 'default'): string {
  return colorConfig.states[state][baseColor];
}

/**
 * Determine the base color of a hexagon based on its coordinates
 * @param x - The x coordinate
 * @param y - The y coordinate
 * @returns The base color ('b', 'g', or 'w')
 */
export function getBaseColor(x: number, y: number): HexagonBaseColor {
  // Using pattern: colorIndex = ((2*x - y) % 3 + 3) % 3
  // 0 = gray (g), 1 = black (b), 2 = white (w)
  const colorIndex = ((2 * x - y) % 3 + 3) % 3;
  if (colorIndex === 0) {
    return 'g'; // gray
  } else if (colorIndex === 1) {
    return 'b'; // black
  } else {
    return 'w'; // white
  }
}
