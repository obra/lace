// ABOUTME: Catch-all 404 route for unmatched paths
// ABOUTME: Returns 404 status without error logging

import { data, Link, useLocation } from 'react-router';

export function loader() {
  return data({}, 404);
}

export default function NotFound() {
  const location = useLocation();

  return (
    <div className="flex h-screen items-center justify-center bg-base-200">
      <div className="text-center">
        <h1 className="text-9xl font-bold text-base-content">404</h1>
        <p className="mt-4 text-xl text-base-content/70">Page not found</p>
        <p className="mt-2 font-mono text-sm text-base-content/50">{location.pathname}</p>
        <Link to="/" className="btn btn-primary mt-8">
          Go Home
        </Link>
      </div>
    </div>
  );
}
