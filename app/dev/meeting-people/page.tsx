// DEV-ONLY: the "Who was in this meeting?" card with its RPCs answered in the
// browser, so it can be looked at without signing in. 404 in production.
import { notFound } from 'next/navigation';
import Harness from './Harness';

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Harness />;
}
