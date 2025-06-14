// ABOUTME: ToolApprovalCoordinator bridges tool approval between backend and UI
// ABOUTME: Extracted from LaceUI to separate tool approval coordination from UI concerns

import { ApprovalEngine } from "../safety/index.js";

export class ToolApprovalCoordinator {
  private approvalEngine: ApprovalEngine;

  constructor(approvalEngine: ApprovalEngine) {
    this.approvalEngine = approvalEngine;
  }

  setUICallback(callback: any): void {
    if (this.approvalEngine && this.approvalEngine.setUICallback) {
      this.approvalEngine.setUICallback(callback);
    }
  }
}