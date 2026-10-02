import { UiIcons, type UiIconName } from '@aliasvault/models/icons';
import React from 'react';

/**
 * Icon props: the icon name plus any svg prop, which overrides the icon's own attributes.
 */
export type IconProps = Omit<React.SVGProps<SVGSVGElement>, 'name'> & {
  name: UiIconName;
};

/**
 * A UI icon from the shared catalog in core/models/src/icons.
 */
const Icon: React.FC<IconProps> = ({ name, ...props }) => {
  const icon = UiIcons[name];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={icon.viewBox} aria-hidden={props['aria-label'] ? undefined : true} {...icon.attrs} {...props}>
      {icon.nodes.map(([tag, attrs], index) => React.createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
};

export default Icon;
