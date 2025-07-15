'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks, faUser, faRobot, faCog, faPlus, faStop, faCheck } from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon, HomeIcon, UserIcon, CogIcon } from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

export default function AtomsPage() {
  const [activeTab, setActiveTab] = useState('tokens');

  const designTokens = {
    colors: {
      semantic: [
        { name: 'Primary', class: 'bg-primary', desc: 'Main brand color, CTAs' },
        { name: 'Secondary', class: 'bg-secondary', desc: 'Supporting actions' },
        { name: 'Accent', class: 'bg-accent', desc: 'Highlights, notifications' },
        { name: 'Neutral', class: 'bg-neutral', desc: 'Text, borders' },
        { name: 'Base-100', class: 'bg-base-100', desc: 'Background surfaces' },
        { name: 'Base-200', class: 'bg-base-200', desc: 'Subtle backgrounds' },
        { name: 'Base-300', class: 'bg-base-300', desc: 'Borders, dividers' },
      ],
      feedback: [
        { name: 'Success', class: 'bg-success', desc: 'Positive feedback' },
        { name: 'Warning', class: 'bg-warning', desc: 'Caution, attention' },
        { name: 'Error', class: 'bg-error', desc: 'Errors, destructive' },
        { name: 'Info', class: 'bg-info', desc: 'Information, tips' },
      ]
    },
    spacing: [
      { name: 'xs', value: '0.25rem', class: 'p-1' },
      { name: 'sm', value: '0.5rem', class: 'p-2' },
      { name: 'md', value: '1rem', class: 'p-4' },
      { name: 'lg', value: '1.5rem', class: 'p-6' },
      { name: 'xl', value: '2rem', class: 'p-8' },
      { name: '2xl', value: '3rem', class: 'p-12' },
    ],
    typography: [
      { name: 'xs', class: 'text-xs', size: '0.75rem', usage: 'Captions, fine print' },
      { name: 'sm', class: 'text-sm', size: '0.875rem', usage: 'Small labels, secondary text' },
      { name: 'base', class: 'text-base', size: '1rem', usage: 'Body text, default' },
      { name: 'lg', class: 'text-lg', size: '1.125rem', usage: 'Large body text' },
      { name: 'xl', class: 'text-xl', size: '1.25rem', usage: 'Subheadings' },
      { name: '2xl', class: 'text-2xl', size: '1.5rem', usage: 'Section headers' },
      { name: '3xl', class: 'text-3xl', size: '1.875rem', usage: 'Page titles' },
    ],
    shadows: [
      { name: 'sm', class: 'shadow-sm', usage: 'Subtle elevation' },
      { name: 'md', class: 'shadow-md', usage: 'Cards, modals' },
      { name: 'lg', class: 'shadow-lg', usage: 'Floating elements' },
      { name: 'xl', class: 'shadow-xl', usage: 'Major elevation' },
    ],
    borderRadius: [
      { name: 'sm', class: 'rounded-sm', value: '0.125rem', usage: 'Buttons, inputs' },
      { name: 'md', class: 'rounded-md', value: '0.375rem', usage: 'Cards, containers' },
      { name: 'lg', class: 'rounded-lg', value: '0.5rem', usage: 'Large cards, modals' },
      { name: 'full', class: 'rounded-full', value: '9999px', usage: 'Avatars, pills' },
    ]
  };

  const buttonVariants = [
    { name: 'Primary', class: 'btn-primary', usage: 'Main actions' },
    { name: 'Secondary', class: 'btn-secondary', usage: 'Secondary actions' },
    { name: 'Accent', class: 'btn-accent', usage: 'Attention grabbing' },
    { name: 'Outline', class: 'btn-outline', usage: 'Subtle actions' },
    { name: 'Ghost', class: 'btn-ghost', usage: 'Minimal actions' },
    { name: 'Link', class: 'btn-link', usage: 'Text-like actions' },
  ];

  const buttonSizes = [
    { name: 'xs', class: 'btn-xs' },
    { name: 'sm', class: 'btn-sm' },
    { name: 'md', class: '' },
    { name: 'lg', class: 'btn-lg' },
  ];

  const inputTypes = [
    { name: 'Text', type: 'text', placeholder: 'Enter text...' },
    { name: 'Password', type: 'password', placeholder: 'Password' },
    { name: 'Email', type: 'email', placeholder: 'email@example.com' },
    { name: 'Search', type: 'search', placeholder: 'Search...' },
  ];

  const fontAwesomeIcons = [
    { icon: faSearch, name: 'Search', usage: 'Search inputs, discovery' },
    { icon: faTerminal, name: 'Terminal', usage: 'Code, CLI, technical' },
    { icon: faTasks, name: 'Tasks', usage: 'Todo items, project management' },
    { icon: faUser, name: 'User', usage: 'Human messages, profiles' },
    { icon: faRobot, name: 'Robot', usage: 'AI messages, automation' },
    { icon: faCog, name: 'Settings', usage: 'Configuration, preferences' },
    { icon: faPlus, name: 'Plus', usage: 'Add, create, expand' },
    { icon: faCheck, name: 'Check', usage: 'Complete, confirm, success' },
    { icon: faStop, name: 'Stop', usage: 'Stop, cancel, end' },
  ];

  const heroIcons = [
    { icon: ChevronDownIcon, name: 'Chevron Down', usage: 'Expanded states, dropdowns' },
    { icon: ChevronRightIcon, name: 'Chevron Right', usage: 'Collapsed states, navigation' },
    { icon: HomeIcon, name: 'Home', usage: 'Main navigation, dashboard' },
    { icon: UserIcon, name: 'User', usage: 'Profile, account' },
    { icon: CogIcon, name: 'Cog', usage: 'Settings, configuration' },
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Atoms</h1>
          <p className="text-base-content/70 mb-4">
            The fundamental building blocks of our design system. These are the smallest functional units that can't be broken down further without losing their meaning.
          </p>
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <div className="w-2 h-2 bg-primary rounded-full"></div>
            <span>Single responsibility • Highly reusable • No internal composition</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-base-100 rounded-lg border border-base-300">
          <div className="flex border-b border-base-300">
            {[
              { id: 'tokens', label: 'Design Tokens', desc: 'Colors, spacing, typography' },
              { id: 'buttons', label: 'Buttons', desc: 'Interactive elements' },
              { id: 'inputs', label: 'Form Controls', desc: 'Input fields, labels' },
              { id: 'icons', label: 'Icons', desc: 'FontAwesome + Heroicons' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 p-4 text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary border-b-2 border-primary'
                    : 'hover:bg-base-200'
                }`}
              >
                <div className="font-medium">{tab.label}</div>
                <div className="text-xs text-base-content/60">{tab.desc}</div>
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Design Tokens */}
            {activeTab === 'tokens' && (
              <div className="space-y-8">
                
                {/* Colors */}
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Color System</h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-semibold text-base-content mb-3">Semantic Colors</h4>
                      <div className="space-y-2">
                        {designTokens.colors.semantic.map((color) => (
                          <div key={color.name} className="flex items-center gap-3">
                            <div className={`w-8 h-8 ${color.class} rounded border border-base-300`}></div>
                            <div className="flex-1">
                              <div className="font-medium text-sm">{color.name}</div>
                              <div className="text-xs text-base-content/60">{color.desc}</div>
                            </div>
                            <code className="text-xs bg-base-200 px-2 py-1 rounded">{color.class}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold text-base-content mb-3">Feedback Colors</h4>
                      <div className="space-y-2">
                        {designTokens.colors.feedback.map((color) => (
                          <div key={color.name} className="flex items-center gap-3">
                            <div className={`w-8 h-8 ${color.class} rounded border border-base-300`}></div>
                            <div className="flex-1">
                              <div className="font-medium text-sm">{color.name}</div>
                              <div className="text-xs text-base-content/60">{color.desc}</div>
                            </div>
                            <code className="text-xs bg-base-200 px-2 py-1 rounded">{color.class}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Typography */}
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Typography Scale</h3>
                  <div className="space-y-3">
                    {designTokens.typography.map((type) => (
                      <div key={type.name} className="flex items-center gap-4 p-3 border border-base-300 rounded">
                        <div className="w-12 text-xs text-base-content/60">{type.name}</div>
                        <div className={`flex-1 ${type.class} font-medium`}>
                          The quick brown fox jumps over the lazy dog
                        </div>
                        <div className="text-xs text-base-content/60">{type.size}</div>
                        <div className="text-xs text-base-content/60 max-w-32">{type.usage}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Spacing */}
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Spacing Scale</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {designTokens.spacing.map((space) => (
                      <div key={space.name} className="border border-base-300 rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{space.name}</span>
                          <code className="text-xs bg-base-200 px-2 py-1 rounded">{space.value}</code>
                        </div>
                        <div className="bg-base-200 rounded">
                          <div className={`bg-primary/20 ${space.class} border-2 border-primary rounded`}>
                            <div className="w-4 h-4 bg-primary rounded"></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Border Radius */}
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Border Radius</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {designTokens.borderRadius.map((radius) => (
                      <div key={radius.name} className="text-center">
                        <div className={`w-16 h-16 bg-primary/20 border-2 border-primary ${radius.class} mx-auto mb-2`}></div>
                        <div className="font-medium text-sm">{radius.name}</div>
                        <div className="text-xs text-base-content/60">{radius.value}</div>
                        <div className="text-xs text-base-content/60 mt-1">{radius.usage}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* Buttons */}
            {activeTab === 'buttons' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Button Variants</h3>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {buttonVariants.map((variant) => (
                      <div key={variant.name} className="border border-base-300 rounded p-4 text-center">
                        <button className={`btn ${variant.class} mb-3`}>
                          {variant.name}
                        </button>
                        <div className="text-sm font-medium">{variant.name}</div>
                        <div className="text-xs text-base-content/60">{variant.usage}</div>
                        <code className="text-xs bg-base-200 px-2 py-1 rounded block mt-2">
                          btn {variant.class}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Button Sizes</h3>
                  <div className="flex flex-wrap items-end gap-4 p-4 border border-base-300 rounded">
                    {buttonSizes.map((size) => (
                      <div key={size.name} className="text-center">
                        <button className={`btn btn-primary ${size.class} mb-2`}>
                          {size.name}
                        </button>
                        <div className="text-xs text-base-content/60">{size.name}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Button States</h3>
                  <div className="grid md:grid-cols-4 gap-4">
                    <div className="border border-base-300 rounded p-4 text-center">
                      <button className="btn btn-primary mb-2">Normal</button>
                      <div className="text-xs text-base-content/60">Default state</div>
                    </div>
                    <div className="border border-base-300 rounded p-4 text-center">
                      <button className="btn btn-primary btn-disabled mb-2">Disabled</button>
                      <div className="text-xs text-base-content/60">Inactive state</div>
                    </div>
                    <div className="border border-base-300 rounded p-4 text-center">
                      <button className="btn btn-primary loading mb-2">Loading</button>
                      <div className="text-xs text-base-content/60">Processing state</div>
                    </div>
                    <div className="border border-base-300 rounded p-4 text-center">
                      <motion.button 
                        className="btn btn-primary mb-2"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        Animated
                      </motion.button>
                      <div className="text-xs text-base-content/60">With motion</div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Form Controls */}
            {activeTab === 'inputs' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Input Types</h3>
                  <div className="grid md:grid-cols-2 gap-6">
                    {inputTypes.map((input) => (
                      <div key={input.name} className="space-y-2">
                        <label className="label">
                          <span className="label-text font-medium">{input.name} Input</span>
                        </label>
                        <input
                          type={input.type}
                          placeholder={input.placeholder}
                          className="input input-bordered w-full"
                        />
                        <code className="text-xs text-base-content/60">
                          type="{input.type}"
                        </code>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Input Variants</h3>
                  <div className="space-y-4">
                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <label className="label">
                          <span className="label-text">Default</span>
                        </label>
                        <input type="text" placeholder="Default input" className="input input-bordered w-full" />
                      </div>
                      <div>
                        <label className="label">
                          <span className="label-text">Success</span>
                        </label>
                        <input type="text" placeholder="Valid input" className="input input-bordered input-success w-full" />
                      </div>
                      <div>
                        <label className="label">
                          <span className="label-text">Error</span>
                        </label>
                        <input type="text" placeholder="Invalid input" className="input input-bordered input-error w-full" />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Other Form Elements</h3>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <label className="label">
                          <span className="label-text">Textarea</span>
                        </label>
                        <textarea 
                          className="textarea textarea-bordered w-full h-24" 
                          placeholder="Multiline text input..."
                        ></textarea>
                      </div>
                      <div>
                        <label className="label">
                          <span className="label-text">Select</span>
                        </label>
                        <select className="select select-bordered w-full">
                          <option disabled selected>Choose option</option>
                          <option>Option 1</option>
                          <option>Option 2</option>
                          <option>Option 3</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="form-control">
                        <label className="label cursor-pointer">
                          <span className="label-text">Checkbox</span>
                          <input type="checkbox" className="checkbox checkbox-primary" />
                        </label>
                      </div>
                      <div className="form-control">
                        <label className="label cursor-pointer">
                          <span className="label-text">Radio Button</span>
                          <input type="radio" name="radio-demo" className="radio radio-primary" />
                        </label>
                      </div>
                      <div className="form-control">
                        <label className="label cursor-pointer">
                          <span className="label-text">Toggle</span>
                          <input type="checkbox" className="toggle toggle-primary" />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Icons */}
            {activeTab === 'icons' && (
              <div className="space-y-8">
                
                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">FontAwesome Icons</h3>
                  <p className="text-base-content/70 mb-4">
                    Rich, semantic icons for specific functionality and branding
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {fontAwesomeIcons.map((iconData) => (
                      <div key={iconData.name} className="border border-base-300 rounded p-4 text-center">
                        <FontAwesomeIcon 
                          icon={iconData.icon} 
                          className="w-8 h-8 text-base-content mb-3"
                        />
                        <div className="font-medium text-sm mb-1">{iconData.name}</div>
                        <div className="text-xs text-base-content/60 mb-2">{iconData.usage}</div>
                        <code className="text-xs bg-base-200 px-2 py-1 rounded block">
                          fa{iconData.name}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Heroicons</h3>
                  <p className="text-base-content/70 mb-4">
                    Clean, minimal icons for navigation and interface elements
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {heroIcons.map((IconComponent, index) => (
                      <div key={index} className="border border-base-300 rounded p-4 text-center">
                        <IconComponent.icon className="w-8 h-8 text-base-content mb-3 mx-auto" />
                        <div className="font-medium text-sm mb-1">{IconComponent.name}</div>
                        <div className="text-xs text-base-content/60 mb-2">{IconComponent.usage}</div>
                        <code className="text-xs bg-base-200 px-2 py-1 rounded block">
                          {IconComponent.name.replace(' ', '')}Icon
                        </code>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-base-content mb-4">Icon Sizes</h3>
                  <div className="flex items-end gap-6 p-4 border border-base-300 rounded">
                    <div className="text-center">
                      <FontAwesomeIcon icon={faSearch} className="w-4 h-4 text-base-content mb-2" />
                      <div className="text-xs text-base-content/60">w-4 h-4</div>
                    </div>
                    <div className="text-center">
                      <FontAwesomeIcon icon={faSearch} className="w-6 h-6 text-base-content mb-2" />
                      <div className="text-xs text-base-content/60">w-6 h-6</div>
                    </div>
                    <div className="text-center">
                      <FontAwesomeIcon icon={faSearch} className="w-8 h-8 text-base-content mb-2" />
                      <div className="text-xs text-base-content/60">w-8 h-8</div>
                    </div>
                    <div className="text-center">
                      <FontAwesomeIcon icon={faSearch} className="w-12 h-12 text-base-content mb-2" />
                      <div className="text-xs text-base-content/60">w-12 h-12</div>
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        </div>

        {/* Usage Guidelines */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Atom Usage Guidelines</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-success">✓ Do</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Use design tokens consistently across all components</li>
                <li>• Combine atoms to create more complex molecules</li>
                <li>• Follow semantic color usage (primary for CTAs, etc.)</li>
                <li>• Use appropriate icon libraries for different contexts</li>
                <li>• Maintain consistent spacing and typography scales</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-base-content mb-3 text-error">✗ Don't</h3>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Create custom colors outside the token system</li>
                <li>• Mix FontAwesome and Heroicons in the same context</li>
                <li>• Use arbitrary spacing values instead of the scale</li>
                <li>• Override atom styles in higher-level components</li>
                <li>• Create atoms that contain other atoms</li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}