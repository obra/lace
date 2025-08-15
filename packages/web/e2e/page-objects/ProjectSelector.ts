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

  get createProjectContinueButton(): Locator {
    return this.page.getByTestId('create-project-continue');
  }

  get providerSelect(): Locator {
    return this.page.getByTestId('create-project-provider-select');
  }

  get modelSelect(): Locator {
    return this.page.getByTestId('create-project-model-select');
  }

  // Actions
  async clickNewProject(): Promise<void> {
    await this.newProjectButton.waitFor({ state: 'visible', timeout: 5000 });
    // Force click to bypass any overlay that might be intercepting
    await this.newProjectButton.click({ force: true });
  }

  async fillProjectForm(name: string, path: string): Promise<void> {
    console.log('DEBUG: Filling project form with path:', path);
    
    // Wait for project path input to be available and fill it
    await this.projectPathInput.waitFor({ state: 'visible', timeout: 5000 });
    
    // Clear any existing content first
    await this.projectPathInput.clear();
    await this.projectPathInput.fill(path);
    
    // Verify the path was filled correctly
    const filledPath = await this.projectPathInput.inputValue();
    console.log('DEBUG: Path actually filled:', filledPath);
    
    // Fill name input only if it's visible (advanced mode)
    const nameInputCount = await this.projectNameInput.count();
    if (nameInputCount > 0) {
      await this.projectNameInput.waitFor({ state: 'visible', timeout: 2000 });
      await this.projectNameInput.clear();
      await this.projectNameInput.fill(name);
    }
  }

  async navigateWizardSteps(): Promise<void> {
    // The UI is a multi-step wizard. Step 1 shows path and name, then Continue to next steps
    
    // Click Continue to advance from step 2 to step 3 (if needed)
    const continueButtonCount = await this.createProjectContinueButton.count();
    console.log('DEBUG: Continue button count:', continueButtonCount);
    
    if (continueButtonCount > 0) {
      // Wait for the button to become enabled (React validation might be async)
      await this.page.waitForFunction(
        () => {
          const button = document.querySelector('[data-testid="create-project-continue"]') as HTMLButtonElement;
          return button && !button.disabled;
        },
        {},
        { timeout: 5000 }
      );
      
      // Double-check if button is enabled
      const isEnabled = await this.createProjectContinueButton.isEnabled();
      console.log('DEBUG: Continue button enabled after wait:', isEnabled);
      
      if (!isEnabled) {
        // If still disabled, log the current path value to debug validation
        const currentPath = await this.projectPathInput.inputValue();
        console.log('DEBUG: Current path value (validation check):', currentPath);
        console.log('DEBUG: Path starts with /:', currentPath.startsWith('/'));
        console.log('DEBUG: Path length > 1:', currentPath.length > 1);
        throw new Error(`Continue button is still disabled after wait. Path: "${currentPath}"`);
      }
      
      await this.createProjectContinueButton.waitFor({ state: 'visible', timeout: 3000 });
      await this.createProjectContinueButton.click();
      
      // Wait for step 3 to load (provider/model selection)
      await this.page.waitForTimeout(1000);
      
      // Step 3: Select provider and model (if available)
      if (await this.providerSelect.count() > 0) {
        console.log('DEBUG: Attempting to select provider and model in step 3');
        
        // Wait for provider options to load
        await this.providerSelect.waitFor({ state: 'visible', timeout: 5000 });
        
        // Check if there are any providers available
        const providerOptions = await this.providerSelect.locator('option').all();
        console.log('DEBUG: Found provider options:', providerOptions.length);
        
        if (providerOptions.length > 1) { // Skip empty option
          const firstProviderValue = await providerOptions[1].getAttribute('value');
          const firstProviderText = await providerOptions[1].textContent();
          if (firstProviderValue) {
            console.log('DEBUG: Selecting provider:', firstProviderValue, firstProviderText);
            await this.providerSelect.selectOption(firstProviderValue);
            
            // Wait for model options to populate after provider selection
            await this.page.waitForTimeout(1000);
            
            // Select the first available model
            const modelOptions = await this.modelSelect.locator('option').all();
            console.log('DEBUG: Found model options:', modelOptions.length);
            
            if (modelOptions.length > 1) { // Skip empty option
              const firstModelValue = await modelOptions[1].getAttribute('value');
              const firstModelText = await modelOptions[1].textContent();
              if (firstModelValue) {
                console.log('DEBUG: Selecting model:', firstModelValue, firstModelText);
                await this.modelSelect.selectOption(firstModelValue);
              }
            } else {
              console.log('DEBUG: No model options available after provider selection');
            }
          }
        } else {
          console.log('DEBUG: No provider options available - may need to skip provider step');
        }
        
        // Wait for validation to enable Continue button
        await this.page.waitForTimeout(500);
      }
      
      // Click Continue again to advance from step 3 to step 4 (if needed)
      if (await this.createProjectContinueButton.count() > 0) {
        // Wait for the button to become enabled after provider/model selection
        await this.page.waitForFunction(
          () => {
            const button = document.querySelector('[data-testid="create-project-continue"]') as HTMLButtonElement;
            return button && !button.disabled;
          },
          {},
          { timeout: 10000 } // Increased timeout to allow for provider initialization
        );
        
        await this.createProjectContinueButton.waitFor({ state: 'visible', timeout: 3000 });
        await this.createProjectContinueButton.click();
        
        // Wait for final step (step 4) to load
        await this.page.waitForTimeout(1000);
      }
    }
  }

  async submitProjectCreation(): Promise<void> {
    await this.createProjectSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.createProjectSubmitButton.click();
  }

  async createProject(name: string, path: string): Promise<void> {
    await this.clickNewProject();
    await this.fillProjectForm(name, path);
    await this.navigateWizardSteps();
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