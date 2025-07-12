'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { TimelineEntry } from '~/types';
import { formatTime } from '~/utils/format';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faInfoCircle, faUser, faRobot, faTerminal, faExternalLinkAlt,
  faFolderPlus, faShare, faEdit, faCheckCircle, faImages, faPlug
} from '~/lib/fontawesome';
import { Carousel } from './Carousel';
import { IntegrationEntry } from './IntegrationEntry';
import { 
  messageVariants, 
  fadeInUp, 
  scaleIn, 
  hoverLift,
  buttonTap,
  springConfig,
  staggerContainer,
  staggerItem
} from '~/lib/animations';

interface AnimatedTimelineMessageProps {
  entry: TimelineEntry;
  index: number;
}

export function AnimatedTimelineMessage({ entry, index }: AnimatedTimelineMessageProps) {
  const renderMessage = (content: string) => {
    // Code block formatting
    let formatted = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      return `<div class="bg-base-300 border border-base-content/20 rounded-lg p-3 my-2 overflow-x-auto">
        <div class="text-xs text-base-content/60 mb-2">${lang || 'code'}</div>
        <pre class="text-accent text-sm"><code>${escapeHtml(code.trim())}</code></pre>
      </div>`;
    });

    // Inline code formatting
    formatted = formatted.replace(
      /`([^`]+)`/g,
      '<code class="bg-base-300 px-2 py-1 rounded text-accent text-sm">$1</code>'
    );

    // Newline formatting
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
  };

  const escapeHtml = (text: string) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Admin Messages
  if (entry.type === 'admin') {
    return (
      <motion.div 
        variants={scaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex justify-center"
        layout
      >
        <motion.div 
          className="bg-base-200 border border-base-300 rounded-full px-4 py-2 text-sm text-base-content/70"
          whileHover={{ scale: 1.02 }}
          transition={springConfig.gentle}
        >
          <div className="flex items-center gap-2">
            <motion.div
              initial={{ rotate: -180, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ delay: 0.2, ...springConfig.bouncy }}
            >
              <FontAwesomeIcon icon={faInfoCircle} className="w-4 h-4 text-info" />
            </motion.div>
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {entry.content}
            </motion.span>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // Human Messages
  if (entry.type === 'human') {
    return (
      <motion.div 
        variants={messageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex gap-3"
        layout
        transition={{ delay: index * 0.05 }}
      >
        <motion.div 
          className="flex-shrink-0"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, ...springConfig.bouncy }}
        >
          <motion.div 
            className="w-8 h-8 rounded-md bg-teal-600 text-white flex items-center justify-center text-sm font-medium"
            whileHover={{ scale: 1.1, rotate: 5 }}
            transition={springConfig.snappy}
          >
            <FontAwesomeIcon icon={faUser} className="text-xs" />
          </motion.div>
        </motion.div>
        <motion.div className="flex-1 min-w-0" variants={staggerContainer}>
          <motion.div className="flex items-baseline gap-2 mb-1" variants={staggerItem}>
            <span className="font-medium text-sm text-base-content">You</span>
            <motion.span 
              className="text-xs text-base-content/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {formatTime(entry.timestamp)}
            </motion.span>
          </motion.div>
          <motion.div 
            className="text-sm leading-relaxed text-base-content"
            variants={staggerItem}
          >
            {entry.content}
          </motion.div>
        </motion.div>
      </motion.div>
    );
  }

  // AI Messages with typing effect
  if (entry.type === 'ai') {
    const agentColors = {
      Claude: 'bg-orange-500 text-white',
      'GPT-4': 'bg-green-600 text-white',
      Gemini: 'bg-blue-600 text-white',
    };

    const agentBadgeColors = {
      Claude: 'bg-orange-900/20 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
      'GPT-4': 'bg-green-900/20 text-green-600 dark:bg-green-900/30 dark:text-green-400',
      Gemini: 'bg-blue-900/20 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    };

    return (
      <motion.div 
        variants={messageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex gap-3"
        layout
        transition={{ delay: index * 0.05 }}
      >
        <motion.div 
          className="flex-shrink-0"
          initial={{ scale: 0, opacity: 0, rotate: -180 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.1, ...springConfig.bouncy }}
        >
          <motion.div
            className={`w-8 h-8 rounded-md flex items-center justify-center text-sm font-medium ${
              agentColors[entry.agent as keyof typeof agentColors] || 'bg-gray-600 text-white'
            }`}
            whileHover={{ scale: 1.1, rotate: -5 }}
            transition={springConfig.snappy}
          >
            <FontAwesomeIcon icon={faRobot} className="text-xs" />
          </motion.div>
        </motion.div>
        <motion.div className="flex-1 min-w-0" variants={staggerContainer}>
          <motion.div className="flex items-baseline gap-2 mb-1" variants={staggerItem}>
            <span className="font-medium text-sm text-base-content">{entry.agent}</span>
            <motion.span 
              className="text-xs text-base-content/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {formatTime(entry.timestamp)}
            </motion.span>
            <motion.span
              className={`text-xs px-1.5 py-0.5 rounded ${
                agentBadgeColors[entry.agent as keyof typeof agentBadgeColors] ||
                'bg-base-content/10 text-base-content/60'
              }`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, ...springConfig.bouncy }}
            >
              {entry.agent}
            </motion.span>
          </motion.div>
          <motion.div
            className="text-sm leading-relaxed text-base-content"
            dangerouslySetInnerHTML={{ __html: renderMessage(entry.content || '') }}
            variants={staggerItem}
          />
        </motion.div>
      </motion.div>
    );
  }

  // Tool Call with animated terminal effect
  if (entry.type === 'tool') {
    return (
      <motion.div 
        variants={messageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex gap-3"
        layout
        transition={{ delay: index * 0.05 }}
      >
        <motion.div 
          className="flex-shrink-0"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, ...springConfig.bouncy }}
        >
          <motion.div 
            className="w-8 h-8 rounded-md bg-teal-100 text-teal-700 flex items-center justify-center text-sm"
            animate={{ 
              boxShadow: [
                "0 0 0 0 rgba(20, 184, 166, 0)",
                "0 0 0 10px rgba(20, 184, 166, 0.1)",
                "0 0 0 0 rgba(20, 184, 166, 0)"
              ]
            }}
            transition={{ 
              duration: 2,
              repeat: Infinity,
              repeatDelay: 1
            }}
          >
            <FontAwesomeIcon icon={faTerminal} className="text-xs" />
          </motion.div>
        </motion.div>
        <motion.div className="flex-1 min-w-0" variants={staggerContainer}>
          <motion.div className="flex items-baseline gap-2 mb-1" variants={staggerItem}>
            <span className="font-medium text-sm text-base-content">Tool</span>
            <motion.span 
              className="text-xs text-base-content/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {formatTime(entry.timestamp)}
            </motion.span>
            <motion.span 
              className="text-xs px-1.5 py-0.5 rounded bg-base-content/10 text-base-content/60"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, ...springConfig.bouncy }}
            >
              {entry.tool}
            </motion.span>
          </motion.div>
          <motion.div 
            className="text-sm font-mono bg-base-200 rounded-lg p-3 border border-base-300"
            variants={fadeInUp}
            {...hoverLift}
          >
            <motion.div 
              className="text-base-content/80 mb-2"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              $ {entry.content}
            </motion.div>
            <motion.div 
              className="text-base-content/60 text-xs whitespace-pre-wrap"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              {entry.result}
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    );
  }

  // Integration with smooth transitions
  if (entry.type === 'integration') {
    const baseEntry = {
      id: entry.id.toString(),
      action: entry.action as 'created' | 'updated' | 'shared' | 'completed',
      title: entry.title || '',
      description: entry.description || '',
      url: entry.link,
      timestamp: entry.timestamp,
    };

    let integrationEntry;
    switch (entry.tool) {
      case 'Google Drive':
        integrationEntry = {
          ...baseEntry,
          type: 'google-drive' as const,
          fileType: 'document' as const,
          sharedWith: ['user@example.com'],
        };
        break;
      case 'Google Sheets':
        integrationEntry = {
          ...baseEntry,
          type: 'google-sheets' as const,
          sheetName: 'Sheet1',
          rowsAdded: 100,
          collaborators: ['user@example.com'],
        };
        break;
      case 'Slack':
        integrationEntry = {
          ...baseEntry,
          type: 'slack' as const,
          channel: '#development',
          messagePreview: entry.description,
        };
        break;
      case 'GitHub':
        integrationEntry = {
          ...baseEntry,
          type: 'github' as const,
          repository: 'lace',
          pullRequest: 123,
        };
        break;
      default:
        integrationEntry = {
          ...baseEntry,
          type: 'google-drive' as const,
          fileType: 'document' as const,
          sharedWith: ['user@example.com'],
        };
    }

    return (
      <motion.div
        variants={fadeInUp}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ delay: index * 0.05 }}
        layout
      >
        <IntegrationEntry entry={integrationEntry} />
      </motion.div>
    );
  }

  // Carousel with animated cards
  if (entry.type === 'carousel' && entry.items) {
    return (
      <motion.div 
        variants={messageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex gap-3"
        layout
        transition={{ delay: index * 0.05 }}
      >
        <motion.div 
          className="flex-shrink-0"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, ...springConfig.bouncy }}
        >
          <motion.div 
            className="w-8 h-8 rounded-md bg-teal-100 text-teal-700 flex items-center justify-center text-sm"
            whileHover={{ scale: 1.1, rotate: 5 }}
            transition={springConfig.snappy}
          >
            <FontAwesomeIcon icon={faImages} className="text-xs" />
          </motion.div>
        </motion.div>
        <motion.div className="flex-1 min-w-0" variants={staggerContainer}>
          <motion.div className="flex items-baseline gap-2 mb-2" variants={staggerItem}>
            <span className="font-medium text-sm text-base-content">System</span>
            <motion.span 
              className="text-xs text-base-content/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {formatTime(entry.timestamp)}
            </motion.span>
          </motion.div>
          <motion.div 
            className="bg-base-100 border border-base-300 rounded-lg p-4 shadow-sm"
            variants={fadeInUp}
            {...hoverLift}
          >
            <motion.h3 
              className="font-semibold text-base-content mb-3"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              {entry.title}
            </motion.h3>
            <Carousel
              showNavigation={true}
              showDots={true}
              className="bg-base-200 rounded-box p-4"
              itemsPerView={{ mobile: 1, tablet: 2, desktop: 3 }}
            >
              {entry.items.map((item, itemIndex) => (
                <motion.div 
                  key={itemIndex}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + itemIndex * 0.1, ...springConfig.gentle }}
                  whileHover={{ y: -4 }}
                >
                  <motion.div 
                    className="card bg-base-100 shadow-sm border border-base-300 h-full"
                    {...hoverLift}
                  >
                    <div className="card-body p-4">
                      <div className="flex items-start justify-between">
                        <h4 className="card-title text-sm">{item.title}</h4>
                        <motion.div
                          className={`badge badge-sm ${
                            item.type === 'feature'
                              ? 'badge-success'
                              : item.type === 'bugfix'
                                ? 'badge-error'
                                : item.type === 'refactor'
                                  ? 'badge-warning'
                                  : 'badge-ghost'
                          }`}
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.4 + itemIndex * 0.1, ...springConfig.bouncy }}
                        >
                          {item.type}
                        </motion.div>
                      </div>
                      <p className="text-xs text-base-content/70 mt-2">{item.description}</p>

                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-base-content/50">Impact:</span>
                          <div className="flex gap-1">
                            {[1, 2, 3].map((i) => (
                              <motion.div
                                key={i}
                                className={`w-2 h-2 rounded-full ${
                                  item.impact === 'high' && i <= 3
                                    ? 'bg-error'
                                    : item.impact === 'medium' && i <= 2
                                      ? 'bg-warning'
                                      : item.impact === 'low' && i <= 1
                                        ? 'bg-success'
                                        : 'bg-base-300'
                                }`}
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ 
                                  delay: 0.5 + itemIndex * 0.1 + i * 0.05, 
                                  ...springConfig.bouncy 
                                }}
                              />
                            ))}
                          </div>
                        </div>
                        <span className="text-xs font-mono text-base-content/50">
                          {item.commit}
                        </span>
                      </div>

                      <div className="mt-3">
                        <span className="text-xs text-base-content/50 block mb-1">Files:</span>
                        {item.files.slice(0, 2).map((file, fileIndex) => (
                          <motion.div
                            key={fileIndex}
                            className="text-xs bg-base-200 px-2 py-1 rounded mb-1 font-mono"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.6 + itemIndex * 0.1 + fileIndex * 0.05 }}
                          >
                            {file}
                          </motion.div>
                        ))}
                        {item.files.length > 2 && (
                          <div className="text-xs text-base-content/50">
                            +{item.files.length - 2} more files
                          </div>
                        )}
                      </div>

                      <div className="card-actions justify-end mt-3">
                        <motion.button 
                          className="btn btn-xs btn-outline"
                          {...buttonTap}
                          whileHover={{ scale: 1.05 }}
                        >
                          <FontAwesomeIcon icon={faExternalLinkAlt} className="mr-1" />
                          View
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              ))}
            </Carousel>
          </motion.div>
        </motion.div>
      </motion.div>
    );
  }

  return null;
}