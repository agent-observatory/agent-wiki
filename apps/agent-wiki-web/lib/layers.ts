import names from "./layer-names.json";

export const LAYER_NAMES = names;
export type Layer = keyof typeof names;
export function layerLabel(layer: Layer) {
  return `${layer} · ${names[layer]}`;
}
