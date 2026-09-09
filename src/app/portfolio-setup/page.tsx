import { redirect } from 'next/navigation';

/**
 * Thesis confirmation now creates the required portfolio containers. Keep this
 * route for old bookmarks, but take users directly to the only manual action
 * that remains: recording a holding after an investment decision.
 */
export default function PortfolioSetupPage() {
  redirect('/positions#add-position');
}
