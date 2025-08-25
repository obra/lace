# Troubleshooting & Common Issues

Solutions to frequently encountered problems when working with React Router 7 Framework Mode.

## Build & Development Issues

### "Cannot find module" Errors

**Problem:** Import errors during development or build.

```
Error: Cannot find module './+types/product'
```

**Solutions:**
1. **Run type generation:** `npm run dev` or `npx react-router typegen`
2. **Check route file exists:** Ensure `app/product.tsx` exists
3. **Restart dev server:** Sometimes types need regeneration

```typescript
// ✅ Correct import after types are generated
import { Route } from "./+types/product";

// ❌ This will fail if types haven't been generated
import { Route } from "./+types/nonexistent";
```

### Hydration Mismatches

**Problem:** Server and client render differently.

```
Warning: Text content did not match. Server: "Loading..." Client: "Welcome John"
```

**Solutions:**
1. **Use `clientLoader` for browser-only data:**

```typescript
export async function clientLoader() {
  // Browser-only data (localStorage, etc.)
  return {
    theme: localStorage.getItem('theme') || 'light'
  };
}

export default function Component({ loaderData }: Route.ComponentProps) {
  // This will be consistent between server and client
  return <div>Theme: {loaderData?.theme || 'default'}</div>;
}
```

2. **Suppress hydration warnings for known differences:**

```typescript
export default function Component() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  if (!mounted) {
    return <div>Loading...</div>; // Server version
  }
  
  return <div>Client content</div>; // Client version
}
```

### Build Failures

**Problem:** Build process fails with cryptic errors.

**Common Causes & Solutions:**

1. **Server code in client bundle:**
```typescript
// ❌ This will break the client build
import { database } from "~/lib/db";

export default function Component() {
  // Don't access server resources in components
  return <div>Home</div>;
}

// ✅ Keep server code in loaders
export async function loader() {
  const data = await database.query("SELECT ...");
  return { data };
}
```

2. **Missing environment variables:**
```typescript
// ❌ Undefined env vars cause build failures
const apiKey = process.env.API_KEY; // Might be undefined

// ✅ Validate environment variables
const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error("API_KEY environment variable is required");
}
```

3. **Type errors:**
```bash
# Fix TypeScript errors first
npm run typecheck
```

## Runtime Errors

### "Cannot read property of undefined"

**Problem:** Accessing properties on undefined data.

```typescript
// ❌ This will crash if product is undefined
export default function Product({ loaderData }: Route.ComponentProps) {
  return <h1>{loaderData.product.name}</h1>;
}
```

**Solutions:**
1. **Add null checks:**
```typescript
export default function Product({ loaderData }: Route.ComponentProps) {
  if (!loaderData?.product) {
    return <div>Product not found</div>;
  }
  
  return <h1>{loaderData.product.name}</h1>;
}
```

2. **Handle in loader:**
```typescript
export async function loader({ params }: Route.LoaderArgs) {
  const product = await getProduct(params.id);
  
  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }
  
  return { product };
}
```

### Form Submission Not Working

**Problem:** Forms don't trigger actions or submissions fail.

**Common Issues:**

1. **Missing method attribute:**
```typescript
// ❌ Defaults to GET, won't trigger action
<Form action="/contact">
  <input name="email" />
  <button type="submit">Submit</button>
</Form>

// ✅ POST triggers action
<Form method="post" action="/contact">
  <input name="email" />
  <button type="submit">Submit</button>
</Form>
```

2. **Form elements outside Form component:**
```typescript
// ❌ Input is outside Form
<div>
  <Form method="post">
    <button type="submit">Submit</button>
  </Form>
  <input name="email" /> {/* This won't be submitted */}
</div>

// ✅ All form elements inside Form
<Form method="post">
  <input name="email" />
  <button type="submit">Submit</button>
</Form>
```

3. **Missing action function:**
```typescript
// ❌ No action export
export default function Contact() {
  return <Form method="post">{/* form */}</Form>;
}

// ✅ Export action function
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  // Process form data
  return null;
}

export default function Contact() {
  return <Form method="post">{/* form */}</Form>;
}
```

## Routing Issues

### Routes Not Matching

**Problem:** Navigation doesn't load expected route.

**Common Causes:**

1. **Incorrect route configuration:**
```typescript
// routes.ts
export default [
  // ❌ This won't match /products/123
  route("/product/:id", "./product.tsx"),
  
  // ✅ Correct path
  route("/products/:id", "./product.tsx"),
];
```

2. **File naming mismatch:**
```typescript
// routes.ts
route("/products/:id", "./product.tsx"), // Looking for product.tsx

// But file is actually named: products.$id.tsx
// ✅ Fix: Update route config or rename file
route("/products/:id", "./products.$id.tsx"),
```

3. **Conflicting routes:**
```typescript
export default [
  route("/products/new", "./new-product.tsx"),
  route("/products/:id", "./product.tsx"), // This would match "new"
  
  // ✅ Put specific routes before dynamic ones
  route("/products/new", "./new-product.tsx"),
  route("/products/:id", "./product.tsx"),
];
```

### 404 Errors in Production

**Problem:** Direct URL navigation fails in production (works in dev).

**Solution:** Configure server to serve `index.html` for all routes:

**Nginx:**
```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

**Apache (.htaccess):**
```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

**Vercel (vercel.json):**
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

## Data Loading Issues

### Data Not Refreshing

**Problem:** Data doesn't update after mutations.

**Solutions:**

1. **Use React Router forms for mutations:**
```typescript
// ✅ This will automatically revalidate
<Form method="post">
  <input name="title" />
  <button type="submit">Update</button>
</Form>

// ❌ Manual fetch won't revalidate
const handleSubmit = async () => {
  await fetch('/api/update', { method: 'POST' });
  // Data won't refresh automatically
};
```

2. **Manual revalidation:**
```typescript
import { useRevalidator } from "react-router";

const revalidator = useRevalidator();

const handleUpdate = async () => {
  await updateData();
  revalidator.revalidate(); // Force data refresh
};
```

### Slow Page Loads

**Problem:** Pages load slowly due to data fetching.

**Solutions:**

1. **Use streaming/Suspense:**
```typescript
import { Suspense } from "react";
import { Await } from "react-router";

export async function loader() {
  return {
    criticalData: await getCriticalData(), // Wait for this
    slowData: getSlowData(), // Don't await - return promise
  };
}

export default function Component({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <h1>{loaderData.criticalData.title}</h1>
      
      <Suspense fallback={<div>Loading additional data...</div>}>
        <Await resolve={loaderData.slowData}>
          {(data) => <SlowComponent data={data} />}
        </Await>
      </Suspense>
    </div>
  );
}
```

2. **Optimize database queries:**
```typescript
// ❌ N+1 query problem
export async function loader() {
  const posts = await getPosts();
  const postsWithAuthors = await Promise.all(
    posts.map(async (post) => ({
      ...post,
      author: await getAuthor(post.authorId), // N queries
    }))
  );
  return { posts: postsWithAuthors };
}

// ✅ Single query with joins
export async function loader() {
  const posts = await getPostsWithAuthors(); // Single query
  return { posts };
}
```

## TypeScript Issues

### Type Errors with Route Types

**Problem:** TypeScript errors with generated route types.

```typescript
// Error: Property 'product' does not exist on type 'LoaderData'
export default function Product({ loaderData }: Route.ComponentProps) {
  return <h1>{loaderData.product.name}</h1>;
}
```

**Solutions:**

1. **Check loader return type matches usage:**
```typescript
// ✅ Ensure loader returns what component expects
export async function loader({ params }: Route.LoaderArgs) {
  return {
    product: await getProduct(params.id), // Must return 'product' property
  };
}
```

2. **Regenerate types:**
```bash
npx react-router typegen
```

3. **Manual type assertion (temporary):**
```typescript
export default function Product({ loaderData }: Route.ComponentProps) {
  const data = loaderData as { product: Product };
  return <h1>{data.product.name}</h1>;
}
```

## Performance Issues

### Large Bundle Sizes

**Problem:** JavaScript bundles are too large.

**Solutions:**

1. **Analyze bundle:**
```bash
npm run build
npx vite-bundle-analyzer dist
```

2. **Lazy load heavy components:**
```typescript
import { lazy, Suspense } from "react";

const HeavyChart = lazy(() => import("./HeavyChart"));

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <Suspense fallback={<div>Loading chart...</div>}>
        <HeavyChart />
      </Suspense>
    </div>
  );
}
```

3. **Split vendor chunks:**
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router'],
        },
      },
    },
  },
});
```

## Debugging Tips

### Enable Debug Logging

```typescript
// Enable React Router debug logs
localStorage.setItem('debug', 'react-router:*');

// Or in development
process.env.DEBUG = 'react-router:*';
```

### Inspect Network Requests

1. **Check Network tab** for failed requests
2. **Look for loader/action calls** in DevTools
3. **Verify response formats** match expected data

### Common Console Errors

**"Cannot read properties of null"**
- Check if DOM elements exist before accessing
- Add null checks for optional data

**"React Hook called conditionally"**
- Ensure hooks are called in the same order every render
- Don't call hooks inside loops or conditions

**"Hydration failed"**
- Server and client must render identical HTML
- Use `clientLoader` for browser-only data

### React Developer Tools

Install React Router DevTools extension for:
- Route inspection
- Data flow visualization  
- Performance monitoring

## Getting Help

When stuck:

1. **Check the error message carefully** - often contains the solution
2. **Look at Network tab** in DevTools for failed requests
3. **Verify route configuration** matches your file structure
4. **Check TypeScript errors** first before runtime issues
5. **Search GitHub issues** for similar problems
6. **Create minimal reproduction** to isolate the problem

Most React Router 7 issues stem from configuration mismatches, missing files, or incorrect data access patterns. Following the framework conventions closely usually resolves most problems.