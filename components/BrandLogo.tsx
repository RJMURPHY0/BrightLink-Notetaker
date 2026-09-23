import { PRODUCT_NAME } from '@/lib/branding';

/**
 * The BrightLink | Notetaker lockup.
 *
 * Two files rather than one: the "Bright" half of the wordmark is near-white,
 * which reads on the dark theme and disappears on a light card.
 *
 * The theme swap is a plain `display: none` in globals.css keyed off
 * `html.dark`, NOT a `dark:` utility. A `dark:block` rule is `.dark .dark\:block`
 * — two classes — so it outranks a caller's own `lg:hidden`, and the mobile copy
 * stayed on screen at desktop width. Hiding from the outside keeps the caller's
 * classes in charge of when the logo shows at all.
 */
export default function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <>
      <img src="/logo.png" alt={PRODUCT_NAME} className={`brand-on-dark ${className}`} />
      <img src="/logo-light.png" alt={PRODUCT_NAME} className={`brand-on-light ${className}`} />
    </>
  );
}
