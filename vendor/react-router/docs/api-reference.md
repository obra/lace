# React Router 7 Framework Mode API Reference

A comprehensive reference for the most commonly used APIs in React Router 7 framework mode, optimized for LLM consumption.

## Table of Contents

1. [Route Module Exports](#route-module-exports)
2. [Components](#components)
3. [Hooks](#hooks)
4. [Utilities](#utilities)
5. [Framework Conventions](#framework-conventions)

---

## Route Module Exports

### `loader`

**TypeScript Signature:**
```tsx
export async function loader(args: Route.LoaderArgs): Promise<any>
```

**Description:**
Server-side data loading function that runs before route components render. Only called on the server during SSR or build-time pre-rendering.

**Example:**
```tsx
export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await getUserById(params.userId);
  return { user };
}

export default function UserPage({ loaderData }: Route.ComponentProps) {
  return <h1>Welcome {loaderData.user.name}</h1>;
}
```

**Common Use Cases:**
- Fetching data from databases or APIs
- Authentication checks
- Loading page-specific data before render

**Framework Mode Notes:**
- Runs on server only
- Data is automatically serialized for client hydration
- Supports Response objects with custom headers/status

### `action`

**TypeScript Signature:**
```tsx
export async function action(args: Route.ActionArgs): Promise<any>
```

**Description:**
Server-side data mutation function called when forms are submitted via `<Form>`, `useFetcher`, or `useSubmit`. Automatically revalidates all loader data on the page.

**Example:**
```tsx
export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const title = formData.get("title");
  await updateProject(params.projectId, { title });
  return { success: true };
}

export default function ProjectPage() {
  return (
    <Form method="post">
      <input name="title" type="text" />
      <button type="submit">Update</button>
    </Form>
  );
}
```

**Common Use Cases:**
- Form submissions
- Data mutations
- CRUD operations
- File uploads

**Framework Mode Notes:**
- Only runs on server
- Triggers automatic revalidation
- Can return redirect responses

### `clientLoader`

**TypeScript Signature:**
```tsx
export async function clientLoader(args: Route.ClientLoaderArgs): Promise<any>
clientLoader.hydrate?: boolean
```

**Description:**
Client-side data loading that runs in the browser. Can supplement or replace server loader data.

**Example:**
```tsx
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  // Call server loader and add client-specific data
  const serverData = await serverLoader();
  const clientData = await getClientSpecificData();
  return { ...serverData, clientData };
}

// Enable hydration participation
clientLoader.hydrate = true as const;
```

**Common Use Cases:**
- Adding client-specific data
- Caching strategies
- Progressive enhancement
- Client-only features

### `clientAction`

**TypeScript Signature:**
```tsx
export async function clientAction(args: Route.ClientActionArgs): Promise<any>
```

**Description:**
Client-side data mutation that runs in the browser. Takes priority over server actions when both are defined.

**Example:**
```tsx
export async function clientAction({ request, serverAction }: Route.ClientActionArgs) {
  const formData = await request.formData();
  
  // Update local cache first
  await updateLocalCache(formData);
  
  // Optionally call server action
  if (isOnline()) {
    return await serverAction();
  }
  
  return { offline: true };
}
```

**Common Use Cases:**
- Offline-first applications
- Client-side caching
- Optimistic updates
- Local storage operations

### `ErrorBoundary`

**TypeScript Signature:**
```tsx
export function ErrorBoundary(): JSX.Element
```

**Description:**
Error boundary component that renders when route module APIs throw errors.

**Example:**
```tsx
import { isRouteErrorResponse, useRouteError } from "react-router";

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div>
        <h1>{error.status} {error.statusText}</h1>
        <p>{error.data}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Something went wrong!</h1>
      <p>{error.message}</p>
    </div>
  );
}
```

**Common Use Cases:**
- Handling loader/action errors
- 404 pages
- Server error pages
- Graceful error handling

---

## Components

### `<Form>`

**TypeScript Signature:**
```tsx
<Form
  action?: string
  method?: "get" | "post" | "put" | "patch" | "delete"
  navigate?: boolean
  replace?: boolean
  preventScrollReset?: boolean
  reloadDocument?: boolean
  // ... other props
/>
```

**Description:**
Progressively enhanced HTML form that submits data via fetch, enabling advanced UIs with pending states and automatic revalidation.

**Example:**
```tsx
import { Form } from "react-router";

function CreatePost() {
  return (
    <Form method="post" action="/posts">
      <input name="title" type="text" required />
      <textarea name="content" required />
      <button type="submit">Create Post</button>
    </Form>
  );
}
```

**Common Use Cases:**
- Form submissions that should navigate
- Progressive enhancement
- Data mutations with navigation

**Framework Mode Notes:**
- Works without JavaScript (progressive enhancement)
- Automatically triggers revalidation
- Supports all HTTP methods

### `<Link>`

**TypeScript Signature:**
```tsx
<Link
  to: string | Partial<Path>
  prefetch?: "none" | "intent" | "render" | "viewport"
  replace?: boolean
  state?: any
  preventScrollReset?: boolean
  relative?: "route" | "path"
  reloadDocument?: boolean
  viewTransition?: boolean
/>
```

**Description:**
Progressively enhanced anchor tag for client-side navigation with prefetching capabilities.

**Example:**
```tsx
import { Link } from "react-router";

function Navigation() {
  return (
    <nav>
      <Link to="/dashboard" prefetch="intent">
        Dashboard
      </Link>
      <Link 
        to="/profile" 
        state={{ from: "navigation" }}
        viewTransition
      >
        Profile
      </Link>
    </nav>
  );
}
```

**Common Use Cases:**
- Navigation between routes
- Prefetching for performance
- Passing navigation state

**Framework Mode Notes:**
- Automatic route discovery and prefetching
- View Transitions support
- Progressive enhancement

### `<Outlet>`

**TypeScript Signature:**
```tsx
<Outlet context?: any />
```

**Description:**
Renders the matching child route component. Used in parent routes to display nested routes.

**Example:**
```tsx
import { Outlet } from "react-router";

export default function Layout() {
  return (
    <div>
      <header>Site Header</header>
      <main>
        <Outlet context={{ theme: "dark" }} />
      </main>
      <footer>Site Footer</footer>
    </div>
  );
}
```

**Common Use Cases:**
- Layout components
- Nested routing
- Passing context to child routes

---

## Hooks

### `useLoaderData`

**TypeScript Signature:**
```tsx
function useLoaderData<T = any>(): SerializeFrom<T>
```

**Description:**
Returns the data from the closest route's loader or clientLoader function.

**Example:**
```tsx
import { useLoaderData } from "react-router";

export async function loader() {
  const posts = await fetchPosts();
  return { posts };
}

export default function PostList() {
  const { posts } = useLoaderData<typeof loader>();
  
  return (
    <ul>
      {posts.map(post => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

**Common Use Cases:**
- Accessing loader data in components
- Type-safe data consumption
- Server-rendered data access

### `useActionData`

**TypeScript Signature:**
```tsx
function useActionData<T = any>(): SerializeFrom<T> | undefined
```

**Description:**
Returns the data from the last action submission, or undefined if no action has been called.

**Example:**
```tsx
import { useActionData, Form } from "react-router";

export default function ContactForm() {
  const actionData = useActionData<{ errors?: Record<string, string> }>();

  return (
    <Form method="post">
      <input name="email" />
      {actionData?.errors?.email && (
        <span className="error">{actionData.errors.email}</span>
      )}
      <button type="submit">Submit</button>
    </Form>
  );
}
```

**Common Use Cases:**
- Form validation errors
- Action success/failure feedback
- Displaying submission results

### `useNavigate`

**TypeScript Signature:**
```tsx
function useNavigate(): NavigateFunction

type NavigateFunction = {
  (to: To, options?: NavigateOptions): void | Promise<void>
  (delta: number): void | Promise<void>
}
```

**Description:**
Returns a function for programmatic navigation. In framework mode, returns a Promise.

**Example:**
```tsx
import { useNavigate } from "react-router";

function UserProfile() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div>
      <h1>Profile</h1>
      <button onClick={handleLogout}>Logout</button>
      <button onClick={() => navigate(-1)}>Go Back</button>
    </div>
  );
}
```

**Common Use Cases:**
- Programmatic navigation
- Form submission redirects
- Conditional navigation
- History manipulation

### `useFetcher`

**TypeScript Signature:**
```tsx
function useFetcher<T = any>(options?: { key?: string }): FetcherWithComponents<T>
```

**Description:**
Provides components and utilities for data loading and submission without navigation. Useful for complex, dynamic UIs.

**Example:**
```tsx
import { useFetcher } from "react-router";

function TodoItem({ todo }) {
  const fetcher = useFetcher();
  
  const isDeleting = fetcher.state === "submitting" && 
                     fetcher.formData?.get("intent") === "delete";

  return (
    <div className={isDeleting ? "opacity-50" : ""}>
      <span>{todo.title}</span>
      <fetcher.Form method="post" action="/todos">
        <input type="hidden" name="id" value={todo.id} />
        <input type="hidden" name="intent" value="delete" />
        <button type="submit">Delete</button>
      </fetcher.Form>
    </div>
  );
}
```

**Common Use Cases:**
- In-place data mutations
- Multiple concurrent requests
- Optimistic UI updates
- Non-navigating form submissions

### `useNavigation`

**TypeScript Signature:**
```tsx
function useNavigation(): Navigation

type Navigation = {
  state: "idle" | "loading" | "submitting"
  location?: Location
  formMethod?: "post" | "get" | "put" | "patch" | "delete"
  formData?: FormData
  formAction?: string
  formEncType?: string
}
```

**Description:**
Returns information about pending page navigation, useful for showing loading states.

**Example:**
```tsx
import { useNavigation } from "react-router";

function GlobalLoadingIndicator() {
  const navigation = useNavigation();
  
  if (navigation.state === "loading") {
    return <div className="loading-bar" />;
  }
  
  if (navigation.state === "submitting") {
    return <div className="saving-indicator">Saving...</div>;
  }
  
  return null;
}
```

**Common Use Cases:**
- Global loading indicators
- Form submission states
- Navigation feedback
- Pending UI states

### `useParams`

**TypeScript Signature:**
```tsx
function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T
```

**Description:**
Returns an object of key-value pairs of the dynamic params from the current URL.

**Example:**
```tsx
import { useParams } from "react-router";

// Route: /users/:userId/posts/:postId
export default function PostDetail() {
  const { userId, postId } = useParams<{ userId: string; postId: string }>();
  
  return (
    <div>
      <h1>Post {postId} by User {userId}</h1>
    </div>
  );
}
```

**Common Use Cases:**
- Accessing URL parameters
- Dynamic route segments
- Building API requests

### `useSearchParams`

**TypeScript Signature:**
```tsx
function useSearchParams(defaultInit?: URLSearchParamsInit): [URLSearchParams, SetURLSearchParams]
```

**Description:**
Returns current URL search parameters and a function to update them.

**Example:**
```tsx
import { useSearchParams } from "react-router";

function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get("category") || "all";

  const handleCategoryChange = (newCategory: string) => {
    setSearchParams(prev => {
      prev.set("category", newCategory);
      return prev;
    });
  };

  return (
    <div>
      <select value={category} onChange={e => handleCategoryChange(e.target.value)}>
        <option value="all">All Categories</option>
        <option value="electronics">Electronics</option>
      </select>
    </div>
  );
}
```

**Common Use Cases:**
- Search functionality
- Filters and pagination
- State persistence in URL

---

## Utilities

### `redirect`

**TypeScript Signature:**
```tsx
function redirect(url: string, init?: number | ResponseInit): Response
```

**Description:**
Creates a redirect Response. Sets status code and Location header. Defaults to 302 Found.

**Example:**
```tsx
import { redirect } from "react-router";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  if (!user) {
    throw redirect("/login");
  }
  return { user };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await createPost(formData);
  return redirect("/posts", 201); // Created status
}
```

**Common Use Cases:**
- Authentication redirects
- Post-action redirects
- Conditional navigation
- Protected routes

### `data`

**TypeScript Signature:**
```tsx
function data<D>(data: D, init?: number | ResponseInit): TypedResponse<D>
```

**Description:**
Creates responses with custom headers/status without forcing serialization into a Response object.

**Example:**
```tsx
import { data } from "react-router";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const item = await createItem(formData);
  
  return data(item, {
    status: 201,
    headers: {
      "X-Custom-Header": "value",
      "Cache-Control": "no-cache"
    }
  });
}
```

**Common Use Cases:**
- Custom response headers
- Specific status codes
- Cache control
- API-like responses

### `isRouteErrorResponse`

**TypeScript Signature:**
```tsx
function isRouteErrorResponse(error: any): error is ErrorResponse
```

**Description:**
Type guard to check if an error is a route error response (like 404, 500, etc.).

**Example:**
```tsx
import { isRouteErrorResponse, useRouteError } from "react-router";

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div>
        <h1>{error.status} {error.statusText}</h1>
        <p>{error.data || "Something went wrong"}</p>
      </div>
    );
  }

  // Regular JavaScript error
  return (
    <div>
      <h1>Unexpected Error</h1>
      <p>{error instanceof Error ? error.message : "Unknown error"}</p>
    </div>
  );
}
```

**Common Use Cases:**
- Error boundary handling
- Distinguishing error types
- Custom error displays

---

## Framework Conventions

### `root.tsx`

**Description:**
Required root route that renders the HTML document and manages document-level components.

**Structure:**
```tsx
import { Outlet, Scripts, ScrollRestoration } from "react-router";

// Optional Layout export for consistent shell
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  return (
    <div>
      <h1>Application Error</h1>
      <p>Something went wrong with the app</p>
    </div>
  );
}
```

**Common Use Cases:**
- Document structure
- Global layouts
- Script loading
- Global error boundaries

### `routes.ts`

**Description:**
Required configuration file that maps URL patterns to route modules.

**Structure:**
```tsx
import { type RouteConfig, route, index, layout } from "@react-router/dev/routes";

export default [
  // Index route
  index("./home.tsx"),
  
  // Basic routes
  route("about", "./about.tsx"),
  route("contact", "./contact.tsx"),
  
  // Dynamic segments
  route("users/:userId", "./user.tsx"),
  
  // Nested routes
  route("dashboard", "./dashboard/layout.tsx", [
    index("./dashboard/overview.tsx"),
    route("settings", "./dashboard/settings.tsx"),
    route("profile", "./dashboard/profile.tsx"),
  ]),
  
  // Layout routes (no path, just for grouping)
  layout("./auth-layout.tsx", [
    route("login", "./login.tsx"),
    route("register", "./register.tsx"),
  ])
] satisfies RouteConfig;
```

**Common Use Cases:**
- Route configuration
- Nested routing
- Layout organization
- Dynamic routing

### Route Module Type Safety

**Description:**
Framework mode provides automatic type generation for route modules.

**Usage:**
```tsx
// Import generated types
import type { Route } from "./+types/user-profile";

export async function loader({ params }: Route.LoaderArgs) {
  // params is automatically typed based on route pattern
  const user = await getUser(params.userId);
  return { user };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  // Handle form submission
  return { success: true };
}

export default function UserProfile({ 
  loaderData, 
  actionData,
  params 
}: Route.ComponentProps) {
  // All props are automatically typed
  return (
    <div>
      <h1>{loaderData.user.name}</h1>
      {actionData?.success && <p>Updated successfully!</p>}
    </div>
  );
}
```

**Framework Mode Notes:**
- Automatic type generation from route patterns
- Type-safe params, loader data, and action data
- IntelliSense support for route APIs

---

## Key Framework Mode Differences

### Automatic Revalidation
- All loader data is automatically revalidated after actions
- No manual cache invalidation needed
- Keeps UI in sync with server state

### Server-Side Rendering
- Loaders run on server for initial page load
- Automatic hydration of client-side state
- Progressive enhancement support

### Type Safety
- Automatic TypeScript types based on route configuration
- Type-safe params, loader data, and action data
- Compile-time route validation

### Performance Optimizations
- Automatic code splitting by route
- Intelligent prefetching strategies
- Optimized bundle loading

### Development Experience
- Hot module replacement for route modules
- Automatic route discovery
- Built-in error boundaries and debugging