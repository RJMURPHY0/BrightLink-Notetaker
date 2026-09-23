import LogoutButton from '@/components/LogoutButton';
import { PRODUCT_SHORT_NAME } from '@/lib/branding';

// Shown in place of any page for someone BrightLink's Team Admin has the
// Notetaker switched off for (middleware.ts rewrites to it). Their data is
// refused separately by getAuthUser() in lib/auth.ts.
export default function SwitchedOffPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface-card p-6 text-center">
        <h1 className="text-lg font-semibold text-ftc-gray">{PRODUCT_SHORT_NAME} is switched off for you</h1>
        <p className="mt-1 text-sm text-ftc-mid">Ask an admin on your team to switch it on.</p>
        <div className="mt-4 flex justify-center" data-nt-chrome>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
