// ABOUTME: FontAwesome configuration and icon exports for web interface
// ABOUTME: Centralizes icon imports and configures FontAwesome for React

import { config } from '@fortawesome/fontawesome-svg-core';

// Prevent FontAwesome from adding CSS since we'll import it manually
config.autoAddCss = false;

// Export all the icons we need for easy importing
export {
  faSearch,
  faTerminal,
  faTasks,
  faFolder,
  faFolderOpen,
  faMicrophone,
  faPaperPlane,
  faPaperclip,
  faBars,
  faTimes,
  faComments,
  faPlus,
  faCheck,
  faCog,
  faFileCode,
  faUser,
  faSignOutAlt,
  // Additional icons for other components
  faCrown,
  faRobot,
  faInfoCircle,
  faCreditCard,
  faExternalLinkAlt,
  faImages,
  faFileAlt,
  faFileExcel,
  faFolderPlus,
  faShare,
  faEdit,
  faCheckCircle,
  faTable,
  faMinus,
  faPlug,
  // Carousel and sidebar navigation
  faChevronLeft,
  faChevronRight,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons';
