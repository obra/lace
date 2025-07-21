import React from 'react';
import type { Decorator } from '@storybook/react';

// Tennis commentary messages for different component interactions
const TENNIS_COMMENTARY = {
  start: [
    "🎾 And here we have a magnificent component warming up!",
    "🎾 The component is taking its position on the court!",
    "🎾 What a beautiful setup we're seeing here!",
    "🎾 The component is ready to serve up some amazing functionality!",
  ],
  hover: [
    "🎾 Ooh, we're seeing some excellent hover behavior!",
    "🎾 The component is responding beautifully to user interaction!",
    "🎾 What precision! The hover state is executed flawlessly!",
    "🎾 Outstanding form in that hover animation!",
  ],
  click: [
    "🎾 BOOM! What a powerful click event!",
    "🎾 Absolutely stunning execution on that click handler!",
    "🎾 The component delivers exactly what was needed!",
    "🎾 Perfect timing on that interaction!",
  ],
  render: [
    "🎾 The component is rendering with championship-level performance!",
    "🎾 Look at that beautiful rendering technique!",
    "🎾 Flawless execution in the render cycle!",
    "🎾 This component is playing at the top of its game!",
  ],
};

// Get random commentary message
const getRandomCommentary = (type: keyof typeof TENNIS_COMMENTARY) => {
  const messages = TENNIS_COMMENTARY[type];
  return messages[Math.floor(Math.random() * messages.length)];
};

// Tennis Commentary Decorator
export const withTennisCommentary: Decorator = (Story, context) => {
  const [commentary, setCommentary] = React.useState<string>('');
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    // Show initial commentary
    setCommentary(getRandomCommentary('start'));
    setIsVisible(true);
    
    // Hide after 3 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [context.args]);

  const handleMouseEnter = () => {
    setCommentary(getRandomCommentary('hover'));
    setIsVisible(true);
    setTimeout(() => setIsVisible(false), 2000);
  };

  const handleClick = () => {
    setCommentary(getRandomCommentary('click'));
    setIsVisible(true);
    setTimeout(() => setIsVisible(false), 2000);
  };

  return (
    <div className="relative">
      {/* Tennis Commentary Display */}
      {isVisible && (
        <div className="fixed top-4 right-4 bg-gradient-to-r from-green-500 to-blue-500 text-white px-4 py-2 rounded-lg shadow-lg animate-bounce z-50 max-w-md">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎾</span>
            <span className="text-sm font-medium">{commentary}</span>
          </div>
        </div>
      )}
      
      {/* Component Wrapper with Event Handlers */}
      <div
        onMouseEnter={handleMouseEnter}
        onClick={handleClick}
        className="transition-all duration-200 hover:scale-105"
      >
        <Story />
      </div>
      
      {/* Commentary Instructions */}
      <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
        <p className="font-medium mb-1">🎾 Tennis Commentary Active!</p>
        <p>• <strong>Hover</strong> over the component for live commentary</p>
        <p>• <strong>Click</strong> the component for performance insights</p>
        <p>• Commentary auto-appears on story changes</p>
      </div>
    </div>
  );
};

// Export individual commentary functions for custom use
export const TennisCommentary = {
  getRandomCommentary,
  TENNIS_COMMENTARY,
};