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
    await this.newProjectButton.click();
  }

  async fillProjectForm(name: string, path: string): Promise<void> {
    // Fill path input (always available)
    await this.projectPathInput.fill(path);
    
    // Fill name input only if it's visible (advanced mode)
    const nameInputCount = await this.projectNameInput.count();
    if (nameInputCount > 0) {
      await this.projectNameInput.fill(name);
    }
  }

  async submitProjectCreation(): Promise<void> {
    await this.createProjectSubmitButton.click();
  }

  async createProject(name: string, path: string): Promise<void> {
    await this.clickNewProject();
    await this.fillProjectForm(name, path);
    await this.submitProjectCreation();
  }

  // Get project list items (for selecting existing projects)
  getProjectCard(projectName: string): Locator {
    return this.page.getByRole('heading', { level: 3, name: projectName });
  }

  async selectExistingProject(projectName: string): Promise<void> {
    await this.getProjectCard(projectName).click();
  }
}