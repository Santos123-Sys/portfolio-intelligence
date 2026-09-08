import { redirect } from 'next/navigation';

/** The guided workflow provides a concrete first action; the old Overview did not. */
export default function HomePage() {
  redirect('/how-it-works');
}
