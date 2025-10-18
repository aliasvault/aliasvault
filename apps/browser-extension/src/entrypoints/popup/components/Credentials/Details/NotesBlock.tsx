import React from 'react';
import { useTranslation } from 'react-i18next';

type NotesBlockProps = {
  notes: string | undefined;
}

/**
 * Convert URLs in text to clickable links.
 */
const convertUrlsToLinks = (text: string): string => {
  const urlPattern = /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/g;

  return text.replace(urlPattern, (url) => {
    const href = url.startsWith('http') ? url : `http://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">${url}</a>`;
  });
};

/**
 * Render the notes block.
 */
const NotesBlock: React.FC<NotesBlockProps> = ({ notes }) => {
  const { t } = useTranslation();
  if (!notes) {
    return null;
  }

  const formattedNotes = convertUrlsToLinks(notes);

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{t('common.notes')}</h2>
      <div className="p-4 bg-gray-50 rounded-lg dark:bg-gray-700">
        <p
          className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: formattedNotes }}
        />
      </div>
    </div>
  );
};

export default NotesBlock;