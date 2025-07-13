// ABOUTME: Account dropdown component with user profile and navigation menu
// ABOUTME: Includes user info, plan status, usage stats, and account management options

'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUser,
  faCog,
  faCreditCard,
  faSignOutAlt,
  faCrown,
} from '~/interfaces/web/lib/fontawesome';
import { ChevronUpIcon } from '~/interfaces/web/lib/heroicons';

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
              <span className="text-white font-bold text-lg">JD</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-teal-500 rounded-full border-2 border-base-100"></div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-base-content truncate">John Developer</div>
            <div className="flex items-center gap-1">
              <FontAwesomeIcon icon={faCrown} className="w-3 h-3 text-yellow-600" />
              <span className="text-xs text-base-content/60">Pro Plan</span>
            </div>
          </div>
          <ChevronUpIcon className="w-4 h-4 text-base-content/40" />
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
              <FontAwesomeIcon icon={faUser} className="w-4 h-4" />
              <span>Profile</span>
            </a>
          </li>
          <li>
            <a className="flex items-center gap-3">
              <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
              <span>Account Settings</span>
            </a>
          </li>
          <li>
            <a className="flex items-center gap-3">
              <FontAwesomeIcon icon={faCreditCard} className="w-4 h-4" />
              <span>Billing</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/20 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400 ml-auto">
                Pro
              </span>
            </a>
          </li>
          <li className="border-t border-base-300 mt-2 pt-2">
            <a className="text-base-content hover:bg-base-200 flex items-center gap-3">
              <FontAwesomeIcon icon={faSignOutAlt} className="w-4 h-4" />
              <span>Sign Out</span>
            </a>
          </li>
        </ul>
      </div>

      {/* Usage Stats */}
      <div className="mt-3 px-3">
        <div className="flex items-center justify-between text-xs text-base-content/60 mb-1">
          <span>API Usage</span>
          <span>847 / 1,000</span>
        </div>
        <div className="w-full bg-base-300 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-teal-600 rounded-full transition-all duration-300"
            style={{ width: '84.7%' }}
          />
        </div>
      </div>
    </div>
  );
}
