import names from "./layer-names.json";
import sections from "./section-names.json";

export const LAYER_NAMES = names;
export type Layer = keyof typeof names;
export function layerLabel(layer: Layer) {
  return `${layer} · ${names[layer]}`;
}

export const SECTION_NAMES = sections;
