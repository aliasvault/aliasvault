import React from 'react';
import { Link } from 'react-router-dom';

import { type ButtonColor, getButtonColorClasses } from '@/components/shared/Button';

type LinkButtonProps = {
  href: string;
  text: string;
  /** Shorter text shown on small screens. */
  smallText?: string;
  color?: ButtonColor;
  additionalClasses?: string;
};

/** Base classes. */
const BASE_CLASSES = 'inline center items-center px-3 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-4';

/**
 * A link styled as a button.
 */
const LinkButton: React.FC<LinkButtonProps> = ({ href, text, smallText = '', color = 'primary', additionalClasses = '' }) => (
  <Link to={href} className={`${BASE_CLASSES} ${getButtonColorClasses(color)} ${additionalClasses}`.trim()}>
    {smallText.length > 0 ? (
      <>
        <span className="md:hidden">{smallText}</span>
        <span className="hidden md:inline">{text}</span>
      </>
    ) : text}
  </Link>
);

export default LinkButton;
