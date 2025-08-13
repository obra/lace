'use client';

// Using FontAwesome instead of Heroicons

export function AccountDropdown() {
  return (
    <div className="mt-auto border-t border-base-300 p-4">
      <div className="dropdown dropdown-top w-full">
        <div
          tabIndex={0}
          role="button"
          className="flex items-center gap-3 p-3 hover:bg-base-200 rounded-lg transition-colors cursor-pointer w-full"
        >
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center ring-2 ring-base-300 shadow-md">
              <span className="text-white font-bold text-lg">U</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-teal-500 rounded-full border-2 border-base-100"></div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-base-content truncate">User</div>
            <div className="flex items-center gap-1">
              <i className="fas fa-crown w-3 h-3 text-yellow-600"></i>
              <span className="text-xs text-base-content/60">Pro Plan</span>
            </div>
          </div>
          <i className="fas fa-chevron-up w-4 h-4 text-base-content/40"></i>
        </div>
        <ul
          tabIndex={0}
          className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-full mb-2 border border-base-300"
        >
          <li className="menu-title">
            <span className="text-xs uppercase text-base-content/50">Account</span>
          </li>
          <li>
            <a className="flex items-center gap-3">
              <i className="fas fa-user w-4 h-4"></i>
              <span>Profile</span>
            </a>
          </li>
          <li>
            <a className="flex items-center gap-3">
              <i className="fas fa-cog w-4 h-4"></i>
              <span>Account Settings</span>
            </a>
          </li>
          <li>
            <a className="flex items-center gap-3">
              <i className="fas fa-credit-card w-4 h-4"></i>
              <span>Billing</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/20 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400 ml-auto">
                Pro
              </span>
            </a>
          </li>
          <li className="border-t border-base-300 mt-2 pt-2">
            <a className="text-base-content hover:bg-base-200 flex items-center gap-3">
              <i className="fas fa-sign-out-alt w-4 h-4"></i>
              <span>Sign Out</span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
