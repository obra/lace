## Environment

- OS: {{system.os}} {{system.arch}}
- Working Directory: {{project.cwd}}
- Session Started: {{system.sessionTime}}

**Git:**
{{#git.branch}}

- Current Branch: {{git.branch}}
  {{/git.branch}}
  {{#git.status}}
- Repository Status: {{git.status}}
  {{/git.status}}
  {{#git.user.name}}
- Git User: {{git.user.name}} <{{git.user.email}}>
  {{/git.user.name}}

**Project Structure:**
{{project.tree}}

IMPORTANT: This environment information was current when the session started, but will not be updated over the course of the conversation
