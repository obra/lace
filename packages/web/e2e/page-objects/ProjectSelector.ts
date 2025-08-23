// ABOUTME: Page object for project selection and creation workflows
// ABOUTME: Encapsulates project-related UI interactions without assertions

import { Page, Locator } from '@playwright/test';
import {
  clickCreateProjectButton,
  fillProjectForm,
  navigateProjectWizardSteps,
  submitProjectCreation,
  createProject as createProjectHelper,
} from '@/e2e/helpers/ui-interactions';

export class ProjectSelector {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Locators for key elements
  get newProjectButton(): Locator {
    // Use the actual testid from ProjectSelectorPanel component
    return this.page.getByTestId('create-project-button');
  }

  get projectNameInput(): Locator {
    return this.page.getByTestId('project-name-input');
  }

  get projectPathInput(): Locator {
    return this.page.getByTestId('project-path-input');
  }

  get createProjectSubmitButton(): Locator {
    return this.page.getByTestId('create-project-submit');
  }

  // Actions - using extracted helpers
  async clickNewProject(): Promise<void> {
    await clickCreateProjectButton(this.page);
  }

  async fillProjectForm(name: string, path: string): Promise<void> {
    await fillProjectForm(this.page, name, path);
  }

  async navigateWizardSteps(): Promise<void> {
    await navigateProjectWizardSteps(this.page);
  }

  async submitProjectCreation(): Promise<void> {
    await submitProjectCreation(this.page);
  }

  async createProject(name: string, path: string): Promise<void> {
    await createProjectHelper(this.page, name, path);
  }

  // Improved visibility checks
  async isNewProjectButtonVisible(): Promise<boolean> {
    try {
      await this.newProjectButton.waitFor({ state: 'visible', timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }

  async waitForProjectSelector(): Promise<void> {
    // Wait for either project list or new project button to be visible
    await Promise.race([
      this.newProjectButton.waitFor({ state: 'visible', timeout: 10000 }),
      this.page
        .locator('h1:has-text("Select a Project")')
        .waitFor({ state: 'visible', timeout: 10000 }),
      this.page.locator('h3').first().waitFor({ state: 'visible', timeout: 10000 }), // Existing project cards
    ]);
  }

  // Get project list items (for selecting existing projects)
  getProjectCard(projectName: string): Locator {
    return this.page.getByRole('heading', { level: 3, name: projectName });
  }

  async selectExistingProject(projectName: string): Promise<void> {
    await this.getProjectCard(projectName).click();
  }
}
