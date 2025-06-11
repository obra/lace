// ABOUTME: Integration tests for navigation functionality  
// ABOUTME: Tests user-observable navigation behavior and mode switching

import React from "react";
import { render } from "ink-testing-library";
import { Box } from "ink";
import StatusBar from "@/ui/components/StatusBar";
import InputBar from "@/ui/components/InputBar";

describe("Navigation Mode Integration", () => {
  test("user can see when navigation mode is active", () => {
    const { lastFrame: normalFrame } = render(
      <StatusBar isNavigationMode={false} />
    );
    
    const { lastFrame: navFrame } = render(
      <StatusBar 
        isNavigationMode={true} 
        scrollPosition={2}
        totalMessages={5}
      />
    );

    const normalOutput = normalFrame();
    const navOutput = navFrame();

    // User should see different status information in navigation mode
    expect(normalOutput).not.toEqual(navOutput);
    
    // Navigation mode should show position information (scrollPosition + 1)
    expect(navOutput).toContain("Line 3 of 5"); // scrollPosition 2 displays as "Line 3"
  });

  test("user sees navigation instructions when in navigation mode", () => {
    const { lastFrame: normalInput } = render(
      <InputBar isNavigationMode={false} />
    );
    
    const { lastFrame: navInput } = render(
      <InputBar isNavigationMode={true} />
    );

    const normalOutput = normalInput();
    const navOutput = navInput();

    // Normal mode shows typing prompt
    expect(normalOutput).toContain("Type your message");
    
    // Navigation mode shows exit instructions
    expect(navOutput).toContain("Navigation mode - Press Escape or q to exit");
  });

  test("user can distinguish between normal and navigation states", () => {
    // Test that both status bar and input bar reflect navigation state
    const normalStatusBar = render(<StatusBar isNavigationMode={false} />);
    const normalInputBar = render(<InputBar isNavigationMode={false} />);
    
    const navStatusBar = render(<StatusBar isNavigationMode={true} scrollPosition={1} totalMessages={3} />);
    const navInputBar = render(<InputBar isNavigationMode={true} />);

    // Normal mode outputs
    const normalStatus = normalStatusBar.lastFrame();
    const normalInput = normalInputBar.lastFrame();
    
    // Navigation mode outputs  
    const navStatus = navStatusBar.lastFrame();
    const navInput = navInputBar.lastFrame();

    // Status should be different between modes
    expect(normalStatus).not.toEqual(navStatus);
    
    // Input should be different between modes
    expect(normalInput).not.toEqual(navInput);
    
    // User should see clear visual indication they're in navigation mode
    expect(navInput).toContain("Navigation mode - Press Escape or q to exit");
  });

  test("navigation mode shows current position in conversation", () => {
    const testCases = [
      { position: 1, total: 5 },
      { position: 3, total: 10 },
      { position: 7, total: 7 }, // At end
    ];

    testCases.forEach(({ position, total }) => {
      const { lastFrame } = render(
        <StatusBar 
          isNavigationMode={true}
          scrollPosition={position}
          totalMessages={total}
        />
      );

      const output = lastFrame();
      
      // User should see their current position (scrollPosition + 1)
      expect(output).toContain(`Line ${position + 1} of ${total}`);
    });
  });

  test("user interface is responsive to navigation state changes", () => {
    // Simulate switching between modes
    const { lastFrame, rerender } = render(
      <Box flexDirection="column">
        <StatusBar isNavigationMode={false} />
        <InputBar isNavigationMode={false} />
      </Box>
    );

    const beforeNav = lastFrame();

    // Switch to navigation mode
    rerender(
      <Box flexDirection="column">
        <StatusBar isNavigationMode={true} scrollPosition={1} totalMessages={4} />
        <InputBar isNavigationMode={true} />
      </Box>
    );

    const afterNav = lastFrame();

    // UI should update to reflect navigation mode
    expect(beforeNav).not.toEqual(afterNav);
    expect(afterNav).toContain("Navigation mode - Press Escape or q to exit");
  });

  test("navigation position updates are visible to user", () => {
    const { lastFrame, rerender } = render(
      <StatusBar isNavigationMode={true} scrollPosition={1} totalMessages={5} />
    );

    const position1 = lastFrame();

    // Move to different position
    rerender(
      <StatusBar isNavigationMode={true} scrollPosition={3} totalMessages={5} />
    );

    const position3 = lastFrame();

    // Position change should be visible
    expect(position1).not.toEqual(position3);
    expect(position1).toContain("Line 2 of 5"); // scrollPosition 1 displays as "Line 2"
    expect(position3).toContain("Line 4 of 5"); // scrollPosition 3 displays as "Line 4"
  });
});