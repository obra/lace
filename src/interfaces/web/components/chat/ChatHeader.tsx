// ABOUTME: Chat header component displaying the application title and branding
// ABOUTME: Simple header with Lace AI Assistant branding and robot icon

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRobot } from '@fortawesome/free-solid-svg-icons';

export default function ChatHeader() {
  return (
    <div className="navbar bg-base-100 shadow-lg">
      <div className="flex-1">
        <h1 className="text-xl font-bold">
          <FontAwesomeIcon icon={faRobot} className="mr-2 text-primary" />
          Lace AI Assistant
        </h1>
      </div>
    </div>
  );
}