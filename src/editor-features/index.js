import {
  activeEditorModeDomPlugin,
  activeEditorModeField
} from './mode-detector.js';
import { shrunkLinksField } from './link-shrinker.js';

export { activeEditorModeField, detectEditorMode } from './mode-detector.js';

export function createEditorFeatureExtensions() {
  return [
    activeEditorModeField,
    activeEditorModeDomPlugin,
    shrunkLinksField
  ];
}
