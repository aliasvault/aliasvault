import { ItemFormPage } from '@/components/items/ItemFormPage';

/**
 * Create item screen as a page, the deep link target. See ItemFormPage for why it is not a modal.
 */
export default function AddItemPageScreen(): React.ReactNode {
  return <ItemFormPage />;
}
