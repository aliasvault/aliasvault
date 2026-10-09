import React from 'react';
import { Link } from 'react-router-dom';

import { BUTTON_BASE_CLASSES, type ButtonColor, getButtonColorClasses, getButtonSizeClasses } from '@/components/shared/Button';
import Icon, { type IconProps } from '@/components/shared/Icon';

type LinkButtonProps = {
  href: string;
  text: string;
  /** Shorter text shown on small screens. */
  smallText?: string;
  /** Icon shown before the text, and instead of it on small screens. */
  icon?: IconProps['name'];
  color?: ButtonColor;
  additionalClasses?: string;
};

/**
 * A link styled as a button.
 */
const LinkButton: React.FC<LinkButtonProps> = ({ href, text, smallText = '', icon, color = 'primary', additionalClasses = '' }) => (
  <Link to={href} className={`${icon ? 'flex' : 'inline'} ${BUTTON_BASE_CLASSES} ${getButtonSizeClasses('md')} ${getButtonColorClasses(color)} ${additionalClasses}`.trim()}>
    {icon ? (
      <>
        <Icon name={icon} className="w-[18px] h-[18px]" />
        <span className="sr-only md:not-sr-only">{text}</span>
      </>
    ) : smallText.length > 0 ? (
      <>
        <span className="md:hidden">{smallText}</span>
        <span className="hidden md:inline">{text}</span>
      </>
    ) : text}
  </Link>
);

export default LinkButton;
