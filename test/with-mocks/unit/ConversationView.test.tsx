// ABOUTME: Unit tests for ConversationView component
// ABOUTME: Tests message display and layout functionality

import React from "react";
import ConversationView from "@/ui/components/ConversationView";
import { Box } from "ink";

describe("ConversationView Component", () => {
  test("renders correct JSX structure with layout props", () => {
    const element = ConversationView({}) as any;

    // Should return a Box element with flexGrow and column direction
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe("column");
    expect(element.props.flexGrow).toBe(1);
    expect(element.props.padding).toBe(1);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("displays mock conversation messages", () => {
    const element = ConversationView({}) as any;
    const children = element.props.children;

    // Should have 4 message components based on mock data
    expect(children).toHaveLength(4);

    // All children should be Message components
    children.forEach((child: any) => {
      expect(child.type.name).toBe("Message");
    });
  });

  test("displays messages with correct types and content", () => {
    const element = ConversationView({}) as any;
    const children = element.props.children;

    // Check first message is user type with "Hello"
    expect(children[0].props.type).toBe("user");
    expect(children[0].props.content).toBe("Hello");

    // Check second message is assistant type
    expect(children[1].props.type).toBe("assistant");
    expect(children[1].props.content).toBe("Hi! How can I help you today?");

    // Check third message is user type
    expect(children[2].props.type).toBe("user");
    expect(children[2].props.content).toBe("Can you write a function?");

    // Check fourth message is assistant with multi-line content
    expect(children[3].props.type).toBe("assistant");
    expect(children[3].props.content).toContain("function hello()");
  });
});
