# Project Structure & File Conventions

Complete guide to organizing React Router 7 Framework Mode projects.

## Minimal Project Structure

```
my-app/
├── app/                    # Application source code
│   ├── routes.ts          # Route configuration
│   ├── root.tsx           # Root layout component
│   ├── entry.client.tsx   # Client entry point
│   └── entry.server.tsx   # Server entry point (optional)
├── public/                 # Static assets
│   └── favicon.ico
├── react-router.config.ts  # Framework configuration
├── vite.config.ts         # Vite configuration
└── package.json
```

## Complete Project Structure

```
my-app/
├── app/
│   ├── routes.ts                    # Route definitions
│   ├── root.tsx                     # Root layout
│   ├── entry.client.tsx             # Client hydration
│   ├── entry.server.tsx             # SSR entry point
│   │
│   ├── routes/                      # Route modules
│   │   ├── _index.tsx              # Home page (/)
│   │   ├── about.tsx               # About page (/about)
│   │   ├── contact.tsx             # Contact page (/contact)
│   │   │
│   │   ├── auth/                   # Auth routes (/auth/*)
│   │   │   ├── login.tsx           # /auth/login
│   │   │   ├── register.tsx        # /auth/register  
│   │   │   └── logout.tsx          # /auth/logout
│   │   │
│   │   ├── products/               # Product routes (/products/*)
│   │   │   ├── _index.tsx          # /products
│   │   │   ├── $id.tsx             # /products/:id
│   │   │   ├── $id_.edit.tsx       # /products/:id/edit
│   │   │   ├── new.tsx             # /products/new
│   │   │   └── _layout.tsx         # Layout for all product routes
│   │   │
│   │   └── admin/                  # Admin routes (/admin/*)
│   │       ├── _layout.tsx         # Protected admin layout
│   │       ├── dashboard.tsx       # /admin/dashboard
│   │       ├── users.tsx           # /admin/users
│   │       └── settings.tsx        # /admin/settings
│   │
│   ├── components/                 # Reusable components
│   │   ├── ui/                     # Basic UI components
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   └── Modal.tsx
│   │   ├── forms/                  # Form components
│   │   │   ├── ProductForm.tsx
│   │   │   └── UserForm.tsx
│   │   └── layout/                 # Layout components
│   │       ├── Header.tsx
│   │       ├── Footer.tsx
│   │       └── Sidebar.tsx
│   │
│   ├── lib/                        # Utilities and configurations
│   │   ├── db.ts                   # Database connection
│   │   ├── auth.ts                 # Authentication utilities
│   │   ├── validations.ts          # Form validation schemas
│   │   └── utils.ts                # General utilities
│   │
│   ├── styles/                     # Stylesheets
│   │   ├── globals.css
│   │   └── components.css
│   │
│   └── +types/                     # Generated TypeScript types
│       ├── root.ts
│       ├── _index.ts
│       └── products.$id.ts
│
├── public/                         # Static files
│   ├── images/
│   ├── uploads/
│   └── favicon.ico
│
├── build/                          # Build output (generated)
│   ├── client/                     # Client bundle
│   └── server/                     # Server bundle
│
├── react-router.config.ts          # Framework config
├── vite.config.ts                  # Vite config
├── tsconfig.json                   # TypeScript config
└── package.json
```

## File Naming Conventions

### Route Files

React Router 7 uses file-based routing with specific naming patterns:

| File Pattern | Route | Description |
|--------------|-------|-------------|
| `_index.tsx` | `/` | Index route for parent segment |
| `about.tsx` | `/about` | Static route segment |
| `$id.tsx` | `/:id` | Dynamic route parameter |
| `$id_.edit.tsx` | `/:id/edit` | Nested route (dot notation) |
| `products/$id.tsx` | `/products/:id` | Nested in directory |
| `_layout.tsx` | N/A | Layout route (no URL segment) |
| `$.tsx` | `/*` | Splat route (catch-all) |

### Special Characters

- **`$`** - Dynamic parameter (`$id` → `:id`)
- **`_`** - Layout route or index (`_layout`, `_index`)
- **`.`** - Nested route separator (`$id_.edit`)
- **`()`** - Route groups (optional, for organization)

## Route Configuration

### Basic Routes (app/routes.ts)

```typescript
import { type RouteConfig, route, index } from "@react-router/dev/routes";

export default [
  // Index route (/)
  index("./home.tsx"),
  
  // Static routes
  route("/about", "./about.tsx"),
  route("/contact", "./contact.tsx"),
  
  // Dynamic routes
  route("/products/:id", "./product.tsx"),
  route("/users/:userId", "./user.tsx"),
  
  // Nested routes
  route("/admin", "./admin/layout.tsx", [
    index("./admin/dashboard.tsx"),
    route("users", "./admin/users.tsx"),
    route("settings", "./admin/settings.tsx"),
  ]),
] satisfies RouteConfig;
```

### Advanced Route Configuration

```typescript
import { type RouteConfig, route, index, layout } from "@react-router/dev/routes";

export default [
  // Layout routes (invisible URL segments)
  layout("./layouts/auth.tsx", [
    route("/login", "./auth/login.tsx"),
    route("/register", "./auth/register.tsx"),
  ]),
  
  // Route with multiple dynamic segments
  route("/projects/:projectId/tasks/:taskId", "./project-task.tsx"),
  
  // Optional segments
  route("/search/:query?", "./search.tsx"),
  
  // Splat routes (catch-all)
  route("/files/*", "./file-browser.tsx"),
  
  // Route groups (for organization only)
  ...route("/api", undefined, [
    route("users", "./api/users.tsx"),
    route("products", "./api/products.tsx"),
  ]),
] satisfies RouteConfig;
```

## Framework Configuration

### react-router.config.ts

```typescript
import { type Config } from "@react-router/dev/config";

export default {
  // Application directory
  appDirectory: "app",
  
  // Server-side rendering
  ssr: true,
  
  // Pre-rendering for static sites
  async prerender() {
    return [
      "/",
      "/about", 
      "/products",
      // Can be dynamic
      ...(await getPublicProductIds()).map(id => `/products/${id}`)
    ];
  },
  
  // Build directory
  buildDirectory: "build",
  
  // Public directory for static assets
  assetsBuildDirectory: "public/build",
  
  // Server build path
  serverBuildFile: "build/server/index.js",
  
  // Server entry point
  serverEntryPoint: "app/entry.server.tsx",
  
  // Vite plugins
  plugins: [
    // Custom Vite plugins
  ],
  
  // Future flags (opt into new features)
  future: {
    unstable_optimizeDeps: true,
  },
} satisfies Config;
```

### Environment-Specific Configurations

```typescript
// react-router.config.ts
import { type Config } from "@react-router/dev/config";

const isDev = process.env.NODE_ENV === "development";
const isProd = process.env.NODE_ENV === "production";

export default {
  appDirectory: "app",
  
  // Disable SSR in development for faster builds
  ssr: isProd,
  
  // Pre-render only in production
  async prerender() {
    if (!isProd) return [];
    
    return [
      "/",
      "/about",
      "/contact",
    ];
  },
  
  // Development optimizations
  ...(isDev && {
    // Dev-specific options
  }),
  
  // Production optimizations  
  ...(isProd && {
    // Prod-specific options
  }),
} satisfies Config;
```

## Entry Points

### app/entry.client.tsx

```typescript
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
```

### app/entry.server.tsx

```typescript
import { renderToString } from "react-dom/server";
import { ServerRouter } from "react-router";
import type { EntryContext } from "react-router";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  const html = renderToString(
    <ServerRouter context={routerContext} url={request.url} />
  );

  return new Response("<!DOCTYPE html>" + html, {
    status: responseStatusCode,
    headers: {
      ...Object.fromEntries(responseHeaders),
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
```

### app/root.tsx

```typescript
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  LiveReload,
} from "react-router";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <header>
          <nav>
            {/* Global navigation */}
          </nav>
        </header>
        
        <main>{children}</main>
        
        <footer>
          {/* Global footer */}
        </footer>
        
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

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

## Best Practices

### 1. Route Organization

**✅ Do:**
```
app/routes/
├── _index.tsx              # Home
├── products/
│   ├── _index.tsx          # Product list
│   ├── $id.tsx             # Product detail
│   └── _layout.tsx         # Product layout
└── admin/
    ├── _layout.tsx         # Admin layout (protected)
    ├── dashboard.tsx       # Dashboard
    └── users.tsx           # User management
```

**❌ Avoid:**
```
app/routes/
├── index.tsx               # Use _index.tsx
├── productList.tsx         # Use products/_index.tsx
├── productDetail.tsx       # Use products/$id.tsx
└── adminDashboard.tsx      # Use admin/dashboard.tsx
```

### 2. Component Organization

**✅ Do:**
```typescript
// Collocate related components
app/routes/products/
├── _index.tsx
├── $id.tsx
├── components/
│   ├── ProductCard.tsx     # Used only in product routes
│   └── ProductForm.tsx
└── utils/
    └── productHelpers.ts
```

### 3. Type Safety

**✅ Do:**
```typescript
// Use generated route types
import { Route } from "./+types/product";

export async function loader({ params }: Route.LoaderArgs) {
  // params.id is type-safe
  return { product: await getProduct(params.id) };
}

export default function Product({ loaderData }: Route.ComponentProps) {
  // loaderData.product is type-safe
  return <h1>{loaderData.product.name}</h1>;
}
```

### 4. Environment Variables

```typescript
// app/lib/env.ts
export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  API_KEY: process.env.API_KEY!,
  NODE_ENV: process.env.NODE_ENV || "development",
} as const;

// Validate required env vars
Object.entries(env).forEach(([key, value]) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});
```

This structure provides a solid foundation for React Router 7 applications while maintaining clear separation of concerns and leveraging the framework's conventions.