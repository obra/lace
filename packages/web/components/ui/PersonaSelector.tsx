// ABOUTME: Searchable persona dropdown component with autocomplete
// ABOUTME: Loads personas from catalog API and provides filtering

'use client';

import React, { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faUser } from '@/lib/fontawesome';
import type { PersonaInfo } from '@/types/core';

interface PersonaSelectorProps {
  personas: PersonaInfo[];
  selectedPersona?: string;
  onChange: (personaName: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function PersonaSelector({
  personas,
  selectedPersona,
  onChange,
  disabled = false,
  className = '',
  placeholder = 'Select persona...',
}: PersonaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPersonas = useMemo(() => {
    if (!searchQuery) return personas;
    return personas.filter((persona) =>
      persona.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [personas, searchQuery]);

  const selectedPersonaInfo = personas.find((p) => p.name === selectedPersona);

  const handleSelect = (personaName: string) => {
    onChange(personaName);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2 bg-base-100 border border-base-300 rounded-lg hover:border-base-400 focus:border-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="persona-selector-trigger"
      >
        <div className="flex items-center gap-2">
          <FontAwesomeIcon icon={faUser} className="w-4 h-4 text-base-content/60" />
          <span className="text-sm">{selectedPersonaInfo?.name || placeholder}</span>
        </div>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg z-50 max-h-60 overflow-hidden">
          <div className="p-2 border-b border-base-300">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search personas..."
              className="w-full px-3 py-1.5 text-sm bg-base-200 rounded border-0 focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="persona-search-input"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filteredPersonas.length === 0 ? (
              <div className="px-3 py-2 text-sm text-base-content/60">No personas found</div>
            ) : (
              filteredPersonas.map((persona) => (
                <button
                  key={persona.name}
                  type="button"
                  onClick={() => handleSelect(persona.name)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-base-200 focus:bg-base-200 focus:outline-none"
                  data-testid={`persona-option-${persona.name}`}
                >
                  <FontAwesomeIcon icon={faUser} className="w-3 h-3 text-base-content/60" />
                  <div>
                    <div className="text-sm font-medium">{persona.name}</div>
                    <div className="text-xs text-base-content/60">
                      {persona.isUserDefined ? 'User Defined' : 'Built-in'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
