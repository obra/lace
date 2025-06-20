## Environment Context

**System Information:**
- OS: {{system.os}} {{system.arch}}
- Working Directory: {{project.cwd}}
- Session Started: {{system.sessionTime}}

**Git Context:**
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