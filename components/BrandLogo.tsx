import { PRODUCT_NAME } from '@/lib/branding';

/**
 * The BrightLink | Notetaker lockup.
 *
 * Two files rather than one: the "Bright" half of the wordmark is near-white,
 * which reads on the dark theme and disappears on a light card. Only one of the
 * pair is ever displayed, so the duplicate alt text never reaches a screen
 * reader — `hidden` removes the other from the accessibility tree.
 */
export default function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <>
      <img src="/logo.png" alt={PRODUCT_NAME} className={`hidden dark:block ${className}`} />
      <img src="/logo-light.png" alt={PRODUCT_NAME} className={`dark:hidden ${className}`} />
    </>
  );
}
