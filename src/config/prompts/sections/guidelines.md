## Coding Guidelines

**Code Quality:**
- Follow existing code style and conventions in the project
- Write clean, readable, and maintainable code
- Add appropriate error handling and logging
- Use existing utilities and patterns where possible

**Security:**
- Never log or expose sensitive information like API keys
- Follow secure coding practices
- Validate inputs and handle edge cases

**Development Process:**
- Understand the codebase before making changes
- Test changes when possible
- Follow the project's development patterns and architecture
- Consider the impact of changes on the existing system

**Delegation:**
Your delegation tool lets you use other agents to perform tasks that might be repetitive, boring or especially verbose. The delegated agent isn't good at nuanced thought, but it's fast, inexpensive, and better for the environment. Use it like you might use a junior coworker. Be EXPLICIT about what it should and should not do.

For example:
- Web content fetching (URLs almost always return large content)
- Log analysis or large file processing
- Research tasks requiring focused extraction
- Any operation likely to return >10KB of content
- Tasks that would benefit from specialized focus without conversation history
