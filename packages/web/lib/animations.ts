// ABOUTME: Animation utilities and variants for Framer Motion
import { Variants, Transition } from 'framer-motion';

// Spring configurations for different animation types
export const springConfig = {
  gentle: { type: 'spring', stiffness: 100, damping: 15 },
  snappy: { type: 'spring', stiffness: 300, damping: 30 },
  bouncy: { type: 'spring', stiffness: 400, damping: 25 },
  smooth: { type: 'spring', stiffness: 200, damping: 40 },
  stiff: { type: 'spring', stiffness: 500, damping: 35 },
} as const;

// Easing functions
const _easings = {
  easeOut: [0.16, 1, 0.3, 1],
  easeIn: [0.55, 0, 1, 0.45],
  easeInOut: [0.4, 0, 0.2, 1],
  easeOutExpo: [0.16, 1, 0.3, 1],
  easeOutBack: [0.175, 0.885, 0.32, 1.275],
} as const;

// Fade variants
export const fadeInUp: Variants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: springConfig.gentle,
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: { duration: 0.2 },
  },
};

const _fadeInDown: Variants = {
  initial: {
    opacity: 0,
    y: -20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: springConfig.gentle,
  },
  exit: {
    opacity: 0,
    y: 10,
    transition: { duration: 0.2 },
  },
};

export const fadeInLeft: Variants = {
  initial: {
    opacity: 0,
    x: -20,
  },
  animate: {
    opacity: 1,
    x: 0,
    transition: springConfig.gentle,
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.2 },
  },
};

const _fadeInRight: Variants = {
  initial: {
    opacity: 0,
    x: 20,
  },
  animate: {
    opacity: 1,
    x: 0,
    transition: springConfig.gentle,
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.2 },
  },
};

// Scale variants
export const scaleIn: Variants = {
  initial: {
    opacity: 0,
    scale: 0.9,
  },
  animate: {
    opacity: 1,
    scale: 1,
    transition: springConfig.snappy,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.2 },
  },
};

export const popIn: Variants = {
  initial: {
    scale: 0,
    opacity: 0,
  },
  animate: {
    scale: 1,
    opacity: 1,
    transition: springConfig.bouncy,
  },
  exit: {
    scale: 0,
    opacity: 0,
    transition: { duration: 0.2 },
  },
};

// Stagger children animation
export const staggerContainer: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const staggerItem: Variants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: springConfig.gentle,
  },
};

// Timeline message variants
export const messageVariants: Variants = {
  initial: {
    opacity: 0,
    x: -20,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      ...springConfig.smooth,
      opacity: { duration: 0.3 },
    },
  },
  exit: {
    opacity: 0,
    x: -10,
    scale: 0.98,
    transition: { duration: 0.2 },
  },
};

// Hover animations
const _hoverScale = {
  whileHover: {
    scale: 1.05,
    transition: springConfig.snappy,
  },
  whileTap: {
    scale: 0.95,
    transition: { duration: 0.1 },
  },
};

export const hoverLift = {
  whileHover: {
    y: -2,
    boxShadow: '0 10px 30px -10px rgba(0,0,0,0.2)',
    transition: springConfig.gentle,
  },
  whileTap: {
    y: 0,
    boxShadow: '0 5px 15px -5px rgba(0,0,0,0.1)',
    transition: { duration: 0.1 },
  },
};

// Button tap effect
export const buttonTap = {
  whileTap: {
    scale: 0.97,
    transition: { duration: 0.1 },
  },
};

// Modal variants
export const modalOverlay: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.2 },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.2 },
  },
};

export const modalContent: Variants = {
  initial: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springConfig.smooth,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.2 },
  },
};

// Sidebar variants
export const sidebarVariants: Variants = {
  open: {
    x: 0,
    transition: springConfig.smooth,
  },
  closed: {
    x: '-100%',
    transition: springConfig.smooth,
  },
};

// Notification variants
export const notificationVariants: Variants = {
  initial: {
    opacity: 0,
    y: -50,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springConfig.bouncy,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -20,
    transition: { duration: 0.2 },
  },
};

// Loading dots animation
export const loadingDots: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.2,
      repeat: Infinity,
    },
  },
};

export const loadingDot: Variants = {
  animate: {
    y: [0, -10, 0],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// Typing indicator animation
const _typingIndicator: Variants = {
  animate: {
    opacity: [0.5, 1, 0.5],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

// Page transition variants
export const pageTransition: Variants = {
  initial: {
    opacity: 0,
    x: -20,
  },
  animate: {
    opacity: 1,
    x: 0,
    transition: {
      ...springConfig.smooth,
      when: 'beforeChildren',
      staggerChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.2 },
  },
};

// Gesture-based animations for mobile
const _swipeableItem = {
  drag: 'x' as const,
  dragConstraints: { left: -100, right: 100 },
  dragElastic: 0.2,
  whileDrag: { scale: 1.02 },
};

// Path drawing animation for icons
const _drawPath = {
  initial: { pathLength: 0, opacity: 0 },
  animate: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { type: 'spring', duration: 1.5, bounce: 0 },
      opacity: { duration: 0.01 },
    },
  },
};

// Shimmer effect for loading skeletons
export const shimmer: Variants = {
  animate: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: {
      duration: 1.5,
      ease: 'linear',
      repeat: Infinity,
    },
  },
};

// Utility function to create custom spring transitions
const _createSpring = (stiffness = 200, damping = 30, mass = 1): Transition => ({
  type: 'spring',
  stiffness,
  damping,
  mass,
});

// Utility function for sequential animations
const _createSequence = (delays: number[]): { animate: { transition: { delay: number } } }[] =>
  delays.map((delay) => ({
    animate: {
      transition: { delay },
    },
  }));

// Focus ring animation
export const focusRing = {
  whileFocus: {
    boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.5)',
    transition: { duration: 0.2 },
  },
};

// Carousel slide animation
const _carouselSlide: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 1000 : -1000,
    opacity: 0,
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1,
    transition: springConfig.smooth,
  },
  exit: (direction: number) => ({
    zIndex: 0,
    x: direction < 0 ? 1000 : -1000,
    opacity: 0,
    transition: springConfig.smooth,
  }),
};
