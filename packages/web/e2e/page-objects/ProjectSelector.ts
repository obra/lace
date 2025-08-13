// ABOUTME: Page object for project selection and creation workflows
// ABOUTME: Encapsulates project-related UI interactions without assertions

import { Page, Locator } from '@playwright/test';

export class ProjectSelector {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Locators for key elements
  get newProjectButton(): Locator {
    return this.page.getByTestId('new-project-button');
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

  // Actions
  async clickNewProject(): Promise<void> {
    await this.newProjectButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.newProjectButton.click();
  }

  async fillProjectForm(name: string, path: string): Promise<void> {
    // Wait for project path input to be available and fill it
    await this.projectPathInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.projectPathInput.fill(path);
    
    // Fill name input only if it's visible (advanced mode)
    const nameInputCount = await this.projectNameInput.count();
    if (nameInputCount > 0) {
      await this.projectNameInput.waitFor({ state: 'visible', timeout: 2000 });
      await this.projectNameInput.fill(name);
    }
  }

  async submitProjectCreation(): Promise<void> {
    await this.createProjectSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.createProjectSubmitButton.click();
  }

  async createProject(name: string, path: string): Promise<void> {
    await this.clickNewProject();
    await this.fillProjectForm(name, path);
    await this.submitProjectCreation();
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
      this.page.locator('h1:has-text("Select a Project")').waitFor({ state: 'visible', timeout: 10000 }),
      this.page.locator('h3').first().waitFor({ state: 'visible', timeout: 10000 }) // Existing project cards
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