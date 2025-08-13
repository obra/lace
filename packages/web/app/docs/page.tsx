// ABOUTME: Simple stub docs page with a basic FAQ for Lace

export default function DocsPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Lace Documentation</h1>
        <p className="text-base-content/70">
          This is a temporary placeholder for Lace docs. More content coming soon.
        </p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">FAQ</h2>
          <div className="space-y-2">
            <details className="collapse border border-base-300 rounded-lg">
              <summary className="collapse-title font-medium">What is Lace?</summary>
              <div className="collapse-content text-base-content/80">
                Lace is an AI-assisted coding environment with agents, tasks, and integrations.
              </div>
            </details>

            <details className="collapse border border-base-300 rounded-lg">
              <summary className="collapse-title font-medium">How do I create a project?</summary>
              <div className="collapse-content text-base-content/80">
                Click "Create your first project" on the home screen to open the onboarding wizard.
              </div>
            </details>

            <details className="collapse border border-base-300 rounded-lg">
              <summary className="collapse-title font-medium">Where do I report issues?</summary>
              <div className="collapse-content text-base-content/80">
                Please open an issue in the repository or contact the Lace team.
              </div>
            </details>
          </div>
        </section>
      </div>
    </main>
  );
}
