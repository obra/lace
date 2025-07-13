// ABOUTME: Animated button components with sophisticated motion and interaction states
// ABOUTME: Includes main AnimatedButton, icon button variant, and animated input component

'use client';

import { motion } from 'framer-motion';
import { buttonTap, hoverLift, springConfig, focusRing } from '~/interfaces/web/lib/animations';

interface AnimatedButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'error' | 'warning' | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

export function AnimatedButton({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
  type = 'button',
  icon,
  iconPosition = 'left',
}: AnimatedButtonProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case 'primary':
        return 'bg-primary text-primary-content hover:bg-primary-focus';
      case 'secondary':
        return 'bg-secondary text-secondary-content hover:bg-secondary-focus';
      case 'ghost':
        return 'bg-transparent text-base-content hover:bg-base-200';
      case 'outline':
        return 'border border-base-300 text-base-content hover:bg-base-200';
      case 'error':
        return 'bg-error text-error-content hover:bg-error-focus';
      case 'warning':
        return 'bg-warning text-warning-content hover:bg-warning-focus';
      case 'success':
        return 'bg-success text-success-content hover:bg-success-focus';
      default:
        return 'bg-primary text-primary-content hover:bg-primary-focus';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'xs':
        return 'px-2 py-1 text-xs';
      case 'sm':
        return 'px-3 py-1.5 text-sm';
      case 'md':
        return 'px-4 py-2 text-sm';
      case 'lg':
        return 'px-6 py-3 text-base';
      default:
        return 'px-4 py-2 text-sm';
    }
  };

  const isInteractive = !disabled && !loading;

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        relative rounded-lg font-medium transition-colors duration-200
        ${getVariantClasses()} ${getSizeClasses()}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
      {...(isInteractive ? buttonTap : {})}
      whileHover={
        isInteractive
          ? {
              scale: 1.02,
              boxShadow: '0 8px 25px -8px rgba(0,0,0,0.2)',
              transition: springConfig.snappy,
            }
          : undefined
      }
      {...(isInteractive ? focusRing : {})}
    >
      {/* Loading spinner */}
      {loading && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'linear',
            }}
          />
        </motion.div>
      )}

      {/* Button content */}
      <motion.div
        className={`flex items-center justify-center gap-2 ${loading ? 'opacity-0' : 'opacity-100'}`}
        transition={{ duration: 0.2 }}
      >
        {icon && iconPosition === 'left' && (
          <motion.span
            initial={{ x: -5, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.1, ...springConfig.gentle }}
          >
            {icon}
          </motion.span>
        )}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
        >
          {children}
        </motion.span>
        {icon && iconPosition === 'right' && (
          <motion.span
            initial={{ x: 5, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.1, ...springConfig.gentle }}
          >
            {icon}
          </motion.span>
        )}
      </motion.div>

      {/* Ripple effect */}
      <motion.div
        className="absolute inset-0 rounded-lg overflow-hidden"
        initial={false}
        whileTap={
          isInteractive
            ? {
                background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
              }
            : undefined
        }
        transition={{ duration: 0.3 }}
      />
    </motion.button>
  );
}

// Specialized button components
export function AnimatedIconButton({
  icon,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  className = '',
  ariaLabel,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const getSizeClasses = () => {
    switch (size) {
      case 'xs':
        return 'w-6 h-6';
      case 'sm':
        return 'w-8 h-8';
      case 'md':
        return 'w-10 h-10';
      case 'lg':
        return 'w-12 h-12';
      default:
        return 'w-10 h-10';
    }
  };

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`
        ${getSizeClasses()} rounded-full flex items-center justify-center
        ${variant === 'ghost' ? 'hover:bg-base-200' : ''}
        ${variant === 'outline' ? 'border border-base-300 hover:bg-base-200' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
      {...(disabled ? {} : buttonTap)}
      whileHover={
        !disabled
          ? {
              scale: 1.1,
              transition: springConfig.snappy,
            }
          : undefined
      }
      {...(!disabled ? focusRing : {})}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, ...springConfig.bouncy }}
      >
        {icon}
      </motion.div>
    </motion.button>
  );
}

// Floating label input with animations
interface AnimatedInputProps {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

export function AnimatedInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  disabled = false,
  className = '',
  icon,
}: AnimatedInputProps) {
  const hasValue = value.length > 0;
  const hasError = !!error;

  return (
    <motion.div className={`relative ${className}`} layout>
      {/* Input field */}
      <motion.div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/40">
            {icon}
          </div>
        )}
        <motion.input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            w-full pt-6 pb-2 px-3 ${icon ? 'pl-10' : ''}
            bg-base-100 border border-base-300 rounded-lg
            text-base-content placeholder-transparent
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
            transition-all duration-200
            ${hasError ? 'border-error focus:border-error focus:ring-error/20' : ''}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          whileFocus={{
            scale: 1.01,
            transition: springConfig.gentle,
          }}
        />

        {/* Floating label */}
        <motion.label
          className={`
            absolute left-3 ${icon ? 'left-10' : ''} transition-all duration-200 cursor-text
            ${hasValue || hasError ? 'top-2 text-xs' : 'top-1/2 transform -translate-y-1/2 text-sm'}
            ${hasError ? 'text-error' : hasValue ? 'text-primary' : 'text-base-content/60'}
          `}
          animate={{
            y: hasValue ? 0 : 0,
            scale: hasValue ? 0.85 : 1,
          }}
          transition={springConfig.gentle}
        >
          {label}
        </motion.label>
      </motion.div>

      {/* Error message */}
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{
          height: hasError ? 'auto' : 0,
          opacity: hasError ? 1 : 0,
        }}
        transition={springConfig.gentle}
        className="overflow-hidden"
      >
        {hasError && (
          <motion.p
            className="text-error text-xs mt-1 px-3"
            initial={{ x: -10 }}
            animate={{ x: 0 }}
            transition={springConfig.gentle}
          >
            {error}
          </motion.p>
        )}
      </motion.div>
    </motion.div>
  );
}