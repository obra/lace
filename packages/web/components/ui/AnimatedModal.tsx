'use client';

import React from 'react';
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@/lib/fontawesome';
import {
  modalOverlay,
  modalContent,
  buttonTap,
  springConfig,
  fadeInUp,
  scaleIn,
} from '@/lib/animations';

interface AnimatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  className?: string;
}

export function AnimatedModal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = '',
}: AnimatedModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Focus management
  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isOpen]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'max-w-md';
      case 'md':
        return 'max-w-lg';
      case 'lg':
        return 'max-w-2xl';
      case 'xl':
        return 'max-w-4xl';
      case 'full':
        return 'max-w-[95vw] max-h-[95vh]';
      default:
        return 'max-w-lg';
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div className="fixed inset-0 z-50 overflow-y-auto">
          {/* Animated Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleBackdropClick}
            aria-hidden="true"
            variants={modalOverlay}
            initial="initial"
            animate="animate"
            exit="exit"
          />

          {/* Modal container */}
          <div className="flex min-h-full items-center justify-center p-4">
            <motion.div
              ref={modalRef}
              className={`
                relative bg-base-100 rounded-xl shadow-2xl border border-base-300/50
                w-full ${getSizeClasses()} ${className}
              `}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? 'modal-title' : undefined}
              tabIndex={-1}
              variants={modalContent}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{
                boxShadow:
                  '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)',
              }}
            >
              {/* Header */}
              {(title || showCloseButton) && (
                <motion.div
                  className="flex items-center justify-between p-6 border-b border-base-300/50"
                  variants={fadeInUp}
                  initial="initial"
                  animate="animate"
                  transition={{ delay: 0.1 }}
                >
                  {title && (
                    <motion.h2
                      id="modal-title"
                      className="text-xl font-semibold text-base-content"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15, ...springConfig.gentle }}
                    >
                      {title}
                    </motion.h2>
                  )}
                  {showCloseButton && (
                    <motion.button
                      onClick={onClose}
                      className="p-2 hover:bg-base-200 rounded-full transition-colors"
                      aria-label="Close modal"
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.2, ...springConfig.bouncy }}
                      {...buttonTap}
                      whileHover={{
                        scale: 1.1,
                        backgroundColor: 'rgba(0,0,0,0.05)',
                        transition: springConfig.snappy,
                      }}
                    >
                      <FontAwesomeIcon icon={faTimes} className="w-5 h-5 text-base-content/60" />
                    </motion.button>
                  )}
                </motion.div>
              )}

              {/* Content */}
              <motion.div
                className="p-6"
                variants={fadeInUp}
                initial="initial"
                animate="animate"
                transition={{ delay: 0.1 }}
              >
                {children}
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Specialized animated modal components
interface AnimatedConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export function AnimatedConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
}: AnimatedConfirmModalProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case 'danger':
        return 'btn-error';
      case 'warning':
        return 'btn-warning';
      case 'info':
        return 'btn-primary';
      default:
        return 'btn-primary';
    }
  };

  const getIconForVariant = () => {
    switch (variant) {
      case 'danger':
        return '⚠️';
      case 'warning':
        return '⚡';
      case 'info':
        return 'ℹ️';
      default:
        return 'ℹ️';
    }
  };

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <AnimatedModal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <motion.div
        className="space-y-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <motion.div
          className="flex items-start gap-4"
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.25, ...springConfig.gentle }}
        >
          <motion.div
            className="text-2xl"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.3, ...springConfig.bouncy }}
          >
            {getIconForVariant()}
          </motion.div>
          <p className="text-base-content/80 leading-relaxed">{message}</p>
        </motion.div>

        <motion.div
          className="flex gap-3 justify-end"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35, ...springConfig.gentle }}
        >
          <motion.button
            onClick={onClose}
            className="btn btn-ghost"
            {...buttonTap}
            whileHover={{
              scale: 1.02,
              transition: springConfig.snappy,
            }}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            {cancelText}
          </motion.button>
          <motion.button
            onClick={handleConfirm}
            className={`btn ${getVariantClasses()}`}
            {...buttonTap}
            whileHover={{
              scale: 1.02,
              boxShadow: '0 8px 25px -8px rgba(0,0,0,0.2)',
              transition: springConfig.snappy,
            }}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.45 }}
          >
            {confirmText}
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatedModal>
  );
}
