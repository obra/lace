// ABOUTME: Main settings route that redirects to the default tab
// ABOUTME: Ensures /settings always shows a specific settings page

import { redirect } from 'react-router';

export function loader() {
  // Redirect to the default settings tab (providers)
  return redirect('/settings/providers');
}
