import React from 'react';

/** Color per first letter of the sender name. */
const ALPHABET_COLORS: Record<string, string> = {
  A: 'hsl(175, 50%, 50%)', B: 'hsl(234, 50%, 50%)', C: 'hsl(278, 50%, 50%)', D: 'hsl(191, 50%, 50%)', E: 'hsl(215, 50%, 50%)',
  F: 'hsl(315, 50%, 50%)', G: 'hsl(247, 50%, 50%)', H: 'hsl(259, 50%, 50%)', I: 'hsl(289, 50%, 50%)', J: 'hsl(206, 50%, 50%)',
  K: 'hsl(124, 50%, 50%)', L: 'hsl(129, 50%, 50%)', M: 'hsl(69, 50%, 50%)', N: 'hsl(38, 50%, 50%)', O: 'hsl(352, 50%, 50%)',
  P: 'hsl(311, 50%, 50%)', Q: 'hsl(332, 50%, 50%)', R: 'hsl(344, 50%, 50%)', S: 'hsl(357, 50%, 50%)', T: 'hsl(23, 50%, 50%)',
  U: 'hsl(16, 50%, 50%)', V: 'hsl(304, 50%, 50%)', W: 'hsl(300, 50%, 50%)', X: 'hsl(332, 50%, 50%)', Y: 'hsl(48, 50%, 50%)', Z: 'hsl(9, 50%, 50%)',
};

/**
 * The initials of a sender name (up to two letters).
 * @param senderName - the display name
 */
const getInitials = (senderName: string): string => {
  const cleaned = senderName.replace(/[^a-zA-Z ]/g, '');
  const letters = cleaned.split(' ').map(n => (n.length > 0 ? n[0] : '')).join('').substring(0, 2).toUpperCase();
  return letters.length > 0 ? letters : '?';
};

/**
 * Colored circle with the sender's initials.
 */
const SenderInitials: React.FC<{ senderName: string; senderEmail: string }> = ({ senderName, senderEmail }) => {
  const initials = getInitials(senderName);
  const color = ALPHABET_COLORS[initials.substring(0, 1)] ?? '#666';

  return (
    <div title={senderEmail} className="justify-content-center align-middle" style={{ paddingTop: '10px', fontSize: '18px', color: 'white', textAlign: 'center', borderRadius: '30px', width: '50px', height: '50px', backgroundColor: color }}>
      {initials}
    </div>
  );
};

export default SenderInitials;
