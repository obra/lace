# ACP Protocol Overview

Source: https://agentclientprotocol.com/protocol/overview.md

The Agent Client Protocol enables structured communication between AI agents and clients using JSON-RPC 2.0 messaging standards.

## Core Communication Model

The protocol implements two message types: **Methods** (request-response pairs expecting results) and **Notifications** (one-way messages without responses).

## Message Flow Pattern

Communication follows three phases:

1. **Initialization**: Client establishes connection and authenticates with the Agent
2. **Session Setup**: Client either creates a new session or loads an existing one
3. **Prompt Turn**: User messages flow to the Agent, which sends progress updates and responses back

## Agent Responsibilities

Agents are autonomous programs leveraging AI to modify code. They provide baseline methods including initialization, authentication, session creation, and prompt handling. Optional capabilities include session loading and operating mode switching.

## Client Responsibilities

Clients function as user interfaces (typically code editors) managing environmental access and user interactions. Their baseline method handles permission requests for tool calls. Optional capabilities encompass file system operations, terminal management, and session updates.

## Protocol Standards

Key requirements include:
- "All file paths in the protocol **MUST** be absolute"
- Line numbering uses 1-based indexing
- Standard JSON-RPC 2.0 error handling applies universally
- Custom functionality allows extensibility through `_meta` fields and underscore-prefixed methods
