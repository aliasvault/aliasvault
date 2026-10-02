/**
 * The icon catalogs shared by all apps, generated from the SVG sources in core/assets/icons.
 */

export {
  ItemTypeIconSvgs,
  getItemTypeIconSvg,
  getAllItemTypeIconKeys,
} from './ItemTypeIcons';

export type {
  ItemTypeIconKey,
} from './ItemTypeIcons';

export {
  BuiltinLogoSvgs,
  getBuiltinLogoSvg,
  getAllBuiltinLogoKeys,
} from './BuiltinLogos';

export type {
  BuiltinLogoKey,
} from './BuiltinLogos';

export {
  UiIcons,
} from './UiIcons';

export type {
  UiIconDefinition,
  UiIconName,
  UiIconNode,
  UiIconTag,
} from './UiIcons';

export {
  createUiIconElement,
  uiIconSvg,
} from './render';

export type {
  SvgDocument,
  SvgElementLike,
  UiIconAttributes,
} from './render';
