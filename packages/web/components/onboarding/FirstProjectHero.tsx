// ABOUTME: Hero section for first-time users with no projects
// ABOUTME: Displays "Code with clarity" messaging and call-to-action for project creation

'use client';

import React from 'react';
import { Link } from 'react-router';

interface FirstProjectHeroProps {
  onCreateFirstProject: () => void;
}

export function FirstProjectHero({ onCreateFirstProject }: FirstProjectHeroProps) {
  return (
    <div className="glass ring-hover p-8">
      <div className="text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Code with clarity.
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
              Not complexity.
            </span>
          </h2>
          <p className="py-4 text-white/85">
            Create your first project to start collaborating with agents.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              className="btn btn-accent ring-hover focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
              onClick={onCreateFirstProject}
              data-testid="create-first-project-button"
            >
              Create your first project
            </button>
            <Link
              className="btn btn-outline border-white/20 text-white hover:border-white/40 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
              to="/docs"
              target="_blank"
              rel="noreferrer"
            >
              View docs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
