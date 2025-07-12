// FontAwesome configuration for React components
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
} from '@fortawesome/free-solid-svg-icons';
