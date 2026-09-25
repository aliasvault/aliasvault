import React from 'react';

type StatusPillProps = {
  enabled: boolean;
  textTrue?: string;
  textFalse?: string;
  color?: 'green' | 'yellow' | 'red' | 'gray';
};

/**
 * Small colored status label.
 */
const StatusPill: React.FC<StatusPillProps> = ({ enabled, textTrue = 'Enabled', textFalse = 'Disabled', color }) => {
  /**
   * The color classes of the pill.
   */
  const pillClass = (): string => {
    if (color) {
      switch (color) {
        case 'green': return 'bg-green-100 text-green-800';
        case 'yellow': return 'bg-yellow-100 text-yellow-800';
        case 'red': return 'bg-red-100 text-red-800';
        default: return 'bg-gray-100 text-gray-800';
      }
    }
    return enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
  };

  return <span className={`${pillClass()} px-2 py-1 text-xs font-medium rounded-full`}>{enabled ? textTrue : textFalse}</span>;
};

export default StatusPill;
