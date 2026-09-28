import React from 'react';
import { Link } from 'react-router-dom';

import { BUTTON_BASE_CLASSES, type ButtonColor, getButtonColorClasses } from '@/components/shared/Button';

type LinkButtonProps = {
  href: string;
  text: string;
  /** Shorter text shown on small screens. */
  smallText?: string;
  color?: ButtonColor;
  additionalClasses?: string;
};

/**
 * A link styled as a button.
 */
const LinkButton: React.FC<LinkButtonProps> = ({ href, text, smallText = '', color = 'primary', additionalClasses = '' }) => (
  <Link to={href} className={`inline ${BUTTON_BASE_CLASSES} ${getButtonColorClasses(color)} ${additionalClasses}`.trim()}>
    {smallText.length > 0 ? (
      <>
        <span className="md:hidden">{smallText}</span>
        <span className="hidden md:inline">{text}</span>
      </>
    ) : text}
  </Link>
);

export default LinkButton;
