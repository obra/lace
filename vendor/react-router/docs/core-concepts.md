# Core Concepts

Essential mental models and patterns for working with React Router 7 Framework Mode.

## Route Modules - The Foundation

Every route in React Router 7 is a **Route Module** - a TypeScript/JavaScript file that can export specific functions and components:

```typescript
// app/products/$productId.tsx
import { Route } from "./+types/products.$productId";

// Server-side data loading
export async function loader({ params }: Route.LoaderArgs) {
  return { product: await getProduct(params.productId) };
}

// Client-side data loading (optional, runs after server loader)
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return { product: await getProductFromCache(params.productId) };
}

// Server-side mutations
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await updateProduct(formData);
  return redirect("/products");
}

// Client-side mutations (optional, runs after server action)
export async function clientAction({ request }: Route.ClientActionArgs) {
  // Handle optimistic updates
  return null;
}

// Error boundary for this route
export function ErrorBoundary() {
  return <div>Something went wrong!</div>;
}

// The route component
export default function Product({ loaderData }: Route.ComponentProps) {
  return <h1>{loaderData.product.name}</h1>;
}
```

## Type Safety Through Generation

React Router 7 automatically generates TypeScript types for your routes:

```typescript
// Automatically generated: app/+types/products.$productId.ts
export interface LoaderArgs {
  params: { productId: string };
  request: Request;
}

export interface ComponentProps {
  loaderData: { product: Product };
}
```

Import these types using the `"+types/filename"` convention:

```typescript
import { Route } from "./+types/products.$productId";
```

## Data Flow Architecture

### Server-First Pattern
1. **Server Loader** runs on the server during SSR or when navigating
2. **Client Loader** (optional) runs on the client after hydration/navigation
3. **Component** renders with combined data

### Action Flow
1. **Form submission** triggers server action
2. **Server Action** processes the mutation
3. **Client Action** (optional) handles optimistic updates
4. **Revalidation** automatically refetches affected loaders

## File-Based Routing

Routes are defined by your file structure in the `app/` directory:

```
app/
├── routes.ts          # Route configuration
├── root.tsx           # Root layout
├── home.tsx           # / route
├── about.tsx          # /about route
├── products/
│   ├── index.tsx      # /products route
│   └── $id.tsx        # /products/:id route
└── admin/
    ├── _layout.tsx    # Layout for all admin routes
    ├── dashboard.tsx  # /admin/dashboard
    └── users.tsx      # /admin/users
```

## Progressive Enhancement Philosophy

React Router 7 follows progressive enhancement:

1. **Base Functionality**: Works without JavaScript
2. **Enhanced UX**: JavaScript adds optimistic updates, transitions
3. **Fallback Gracefully**: Forms submit normally if JS fails

```typescript
// This form works with or without JavaScript
export default function ContactForm() {
  return (
    <Form method="post" action="/contact">
      <input name="email" type="email" required />
      <button type="submit">Send</button>
    </Form>
  );
}
```

## State Management Strategy

### URL as Source of Truth
- **Route params**: `/products/$id` 
- **Search params**: `/products?category=electronics&page=2`
- **Route data**: Loaded via loaders, cached automatically

### Local State for UI Only
- Form input states
- Modal open/closed
- Temporary UI states

```typescript
// Good: URL-driven state
const [searchParams] = useSearchParams();
const category = searchParams.get('category');
const page = parseInt(searchParams.get('page') || '1');

// Good: UI-only local state  
const [isModalOpen, setIsModalOpen] = useState(false);

// Avoid: Important app state in local state
// const [currentUser, setCurrentUser] = useState(); // ❌
```

## Component Hierarchy

```typescript
// app/root.tsx - Application shell
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <header>Global Navigation</header>
        <main>{children}</main>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />; // Renders matched route
}
```

## Error Handling Patterns

### Route-Level Error Boundaries
```typescript
export function ErrorBoundary({ error }: { error: Error }) {
  return (
    <div>
      <h1>Oops!</h1>
      <p>{error.message}</p>
    </div>
  );
}
```

### Global Error Handling
```typescript
// app/root.tsx
export function ErrorBoundary() {
  return (
    <html>
      <body>
        <h1>Application Error</h1>
        <p>Something went wrong</p>
      </body>
    </html>
  );
}
```

## Code Splitting & Performance

### Automatic Route Splitting
Routes are automatically split into separate chunks for optimal loading.

### Manual Component Splitting
```typescript
import { lazy } from "react";

const HeavyComponent = lazy(() => import("../components/HeavyComponent"));

export default function MyRoute() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HeavyComponent />
    </Suspense>
  );
}
```

## Server vs Client Execution

### Server Context
- Node.js environment
- Database access
- File system access
- Environment variables
- No DOM/window objects

### Client Context  
- Browser environment
- DOM access
- localStorage/sessionStorage
- Web APIs
- No file system access

```typescript
// ❌ This will break on server
export async function loader() {
  const data = localStorage.getItem('cache'); // Error!
  return { data };
}

// ✅ Server-safe
export async function loader() {
  return { data: await fetchFromAPI() };
}

// ✅ Client-safe
export async function clientLoader() {
  const cached = localStorage.getItem('cache');
  return cached ? JSON.parse(cached) : null;
}
```

## Key Principles for LLMs

1. **Route modules are the core building blocks**
2. **Server-first, then enhance with client features**
3. **URL is the primary state container**
4. **Progressive enhancement ensures reliability**
5. **Type safety through auto-generation**
6. **Automatic code splitting and performance optimization**
7. **Clear separation of server and client contexts**