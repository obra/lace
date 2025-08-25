# React Router 7 Framework - LLM Development Guide

This documentation is specifically organized for LLM coding agents working with React Router 7 in Framework Mode.

## 🚀 Quick Start for LLMs

When asked to work with React Router 7, start here:

1. **[Core Concepts](./core-concepts.md)** - Essential mental models and patterns
2. **[API Quick Reference](./api-reference.md)** - Complete API with examples
3. **[Common Patterns](./common-patterns.md)** - Frequently used implementations
4. **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions

## 📚 Documentation Structure

### Core Framework Knowledge
- **[Core Concepts](./core-concepts.md)** - Route modules, data flow, type safety
- **[Project Structure](./project-structure.md)** - File conventions and organization
- **[Route Configuration](./routing.md)** - Route definition and matching
- **[Data Patterns](./data-patterns.md)** - Loading, actions, and state management

### API Documentation
- **[API Reference](./api-reference.md)** - Complete API with TypeScript signatures
- **[Components](./components.md)** - Form, Link, Meta, Scripts, etc.
- **[Hooks](./hooks.md)** - useLoaderData, useFetcher, useNavigate, etc.
- **[Utilities](./utilities.md)** - Sessions, cookies, redirects, path helpers

### Implementation Guides
- **[Common Patterns](./common-patterns.md)** - Authentication, CRUD, forms, validation
- **[Performance](./performance.md)** - Code splitting, caching, optimization
- **[Security](./security.md)** - CSRF, validation, safe practices
- **[Testing](./testing.md)** - Unit and integration testing strategies

### Advanced Topics
- **[Server Rendering](./server-rendering.md)** - SSR, streaming, hydration
- **[Deployment](./deployment.md)** - Build process, adapters, environments
- **[Troubleshooting](./troubleshooting.md)** - Common errors and debugging

## 🎯 When to Use What

### For Basic Routing
```typescript
// app/routes.ts
import { route, index } from "@react-router/dev/routes";

export default [
  index("./home.tsx"),
  route("/about", "./about.tsx"),
  route("/products/:id", "./product.tsx"),
];
```

### For Data Loading
```typescript
// app/product.tsx
import { Route } from "./+types/product";

export async function loader({ params }: Route.LoaderArgs) {
  return { product: await getProduct(params.id) };
}

export default function Product({ loaderData }: Route.ComponentProps) {
  return <h1>{loaderData.product.name}</h1>;
}
```

### For Form Handling
```typescript
// app/contact.tsx
import { Route } from "./+types/contact";
import { redirect } from "react-router";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await sendEmail(formData);
  return redirect("/thank-you");
}

export default function Contact() {
  return <Form method="post">{/* form fields */}</Form>;
}
```

## 🧠 Key Mental Models for LLMs

1. **Route Modules are the Core Unit** - Each route is a self-contained module with loader, action, and component
2. **Server-First with Client Enhancement** - Start with server functionality, enhance with client features
3. **Progressive Enhancement** - Apps work without JavaScript, enhanced with it
4. **Type Safety Through Generation** - Route types are auto-generated from your route modules
5. **URL-First State Management** - URL is the primary source of truth for application state

## 🚨 Common Gotchas for LLMs

- Route modules must export functions, not arrow functions assigned to const
- `clientLoader` runs in addition to `loader`, not instead of it
- `Form` component is different from native `<form>` - use for React Router actions
- Type imports use `Route` from `"+types/filename"` pattern
- Server code can't access browser APIs (window, document, etc.)

## 📖 Quick Reference Patterns

See [Common Patterns](./common-patterns.md) for copy-paste implementations of:
- Authentication flows
- CRUD operations  
- Form validation
- File uploads
- Error handling
- Search and filtering
- Real-time updates
- API integrations

---

**Last Updated**: React Router v7.0  
**Target Audience**: LLM Coding Agents  
**Framework Mode Only**: This guide focuses exclusively on React Router Framework Mode