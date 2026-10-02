import React from 'react';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

import { UiIcons, type UiIconName, type UiIconTag } from '@aliasvault/models/icons';

type UiIconProps = {
  name: UiIconName;
  size: number;
  /** The color for currentColor in the icon. */
  color: string;
  strokeWidth?: number;
};

const SHAPES: Record<UiIconTag, React.ElementType> = {
  path: Path,
  circle: Circle,
  rect: Rect,
  line: Line,
  polyline: Polyline,
  polygon: Polygon,
  ellipse: Ellipse,
};

/**
 * A UI icon from the shared catalog in core/models/src/icons, drawn with react-native-svg.
 */
export const UiIcon: React.FC<UiIconProps> = ({ name, size, color, strokeWidth }) => {
  const icon = UiIcons[name];
  return (
    <Svg width={size} height={size} viewBox={icon.viewBox} color={color} {...icon.attrs} {...(strokeWidth === undefined ? {} : { strokeWidth })}>
      {icon.nodes.map(([tag, attrs], index) => React.createElement(SHAPES[tag], { key: String(index), ...attrs }))}
    </Svg>
  );
};

export default UiIcon;
