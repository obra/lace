# Common Patterns

Copy-paste implementations of frequently used patterns in React Router 7 Framework Mode.

## Authentication & Authorization

### Protected Route Pattern

```typescript
// app/admin/_layout.tsx
import { Route } from "./+types/_layout";
import { redirect } from "react-router";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getCurrentUser(request);
  if (!user || !user.isAdmin) {
    throw redirect("/login");
  }
  return { user };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <nav>Admin Navigation for {loaderData.user.name}</nav>
      <Outlet />
    </div>
  );
}
```

### Login Form with Validation

```typescript
// app/login.tsx
import { Route } from "./+types/login";
import { Form, redirect, useActionData } from "react-router";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // Validation
  const errors: Record<string, string> = {};
  if (!email) errors.email = "Email is required";
  if (!password) errors.password = "Password is required";
  if (Object.keys(errors).length > 0) {
    return { errors, status: 400 };
  }

  // Authentication
  try {
    const user = await signIn(email, password);
    const session = await createSession(user.id);
    
    return redirect("/dashboard", {
      headers: {
        "Set-Cookie": `session=${session.id}; HttpOnly; Secure; SameSite=Strict`
      }
    });
  } catch (error) {
    return { 
      errors: { form: "Invalid email or password" }, 
      status: 401 
    };
  }
}

export default function Login() {
  const actionData = useActionData<typeof action>();

  return (
    <Form method="post">
      <div>
        <label htmlFor="email">Email</label>
        <input type="email" name="email" required />
        {actionData?.errors?.email && (
          <p className="error">{actionData.errors.email}</p>
        )}
      </div>
      
      <div>
        <label htmlFor="password">Password</label>
        <input type="password" name="password" required />
        {actionData?.errors?.password && (
          <p className="error">{actionData.errors.password}</p>
        )}
      </div>
      
      {actionData?.errors?.form && (
        <p className="error">{actionData.errors.form}</p>
      )}
      
      <button type="submit">Sign In</button>
    </Form>
  );
}
```

## CRUD Operations

### List with Search and Pagination

```typescript
// app/products/index.tsx
import { Route } from "./+types/index";
import { Link, useSearchParams, useSubmit } from "react-router";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 10;

  const { products, totalCount } = await getProducts({
    search,
    page,
    limit
  });

  return {
    products,
    search,
    page,
    totalPages: Math.ceil(totalCount / limit)
  };
}

export default function ProductsList({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const submit = useSubmit();

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    const search = formData.get("search") as string;
    
    submit(
      { search, page: "1" },
      { method: "get", replace: true }
    );
  };

  return (
    <div>
      <form onSubmit={handleSearch}>
        <input
          type="search"
          name="search"
          defaultValue={loaderData.search}
          placeholder="Search products..."
        />
        <button type="submit">Search</button>
      </form>

      <div className="products">
        {loaderData.products.map((product) => (
          <div key={product.id}>
            <Link to={`/products/${product.id}`}>
              <h3>{product.name}</h3>
            </Link>
            <p>${product.price}</p>
          </div>
        ))}
      </div>

      <div className="pagination">
        {Array.from({ length: loaderData.totalPages }, (_, i) => i + 1).map(
          (pageNum) => (
            <Link
              key={pageNum}
              to={`?${new URLSearchParams({
                ...Object.fromEntries(searchParams),
                page: pageNum.toString()
              })}`}
              className={pageNum === loaderData.page ? "active" : ""}
            >
              {pageNum}
            </Link>
          )
        )}
      </div>
    </div>
  );
}
```

### Create/Edit Form with Optimistic Updates

```typescript
// app/products/$id.edit.tsx
import { Route } from "./+types/$id.edit";
import { Form, redirect, useActionData, useNavigate } from "react-router";

export async function loader({ params }: Route.LoaderArgs) {
  const product = await getProduct(params.id);
  if (!product) throw new Response("Not found", { status: 404 });
  return { product };
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    await deleteProduct(params.id);
    return redirect("/products");
  }

  // Update product
  const name = formData.get("name") as string;
  const price = parseFloat(formData.get("price") as string);
  
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Name is required";
  if (!price || price <= 0) errors.price = "Price must be greater than 0";
  
  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  await updateProduct(params.id, { name, price });
  return redirect(`/products/${params.id}`);
}

export default function EditProduct({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();

  return (
    <div>
      <Form method="post">
        <div>
          <label htmlFor="name">Name</label>
          <input
            name="name"
            defaultValue={loaderData.product.name}
            required
          />
          {actionData?.errors?.name && (
            <p className="error">{actionData.errors.name}</p>
          )}
        </div>

        <div>
          <label htmlFor="price">Price</label>
          <input
            name="price"
            type="number"
            step="0.01"
            defaultValue={loaderData.product.price}
            required
          />
          {actionData?.errors?.price && (
            <p className="error">{actionData.errors.price}</p>
          )}
        </div>

        <div className="buttons">
          <button type="submit">Update Product</button>
          <button
            type="submit"
            name="intent"
            value="delete"
            className="danger"
            onClick={(e) => {
              if (!confirm("Are you sure you want to delete this product?")) {
                e.preventDefault();
              }
            }}
          >
            Delete
          </button>
          <button type="button" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </Form>
    </div>
  );
}
```

## File Uploads

### Single File Upload with Validation

```typescript
// app/upload.tsx
import { Route } from "./+types/upload";
import { Form, useActionData } from "react-router";
import { writeAsyncIterableToWritable } from "@remix-run/node";
import { createWriteStream } from "fs";
import path from "path";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  // Validation
  const errors: Record<string, string> = {};
  if (!file || file.size === 0) {
    errors.file = "Please select a file";
  } else if (file.size > 5 * 1024 * 1024) { // 5MB limit
    errors.file = "File must be less than 5MB";
  } else if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
    errors.file = "File must be an image (JPEG, PNG, or GIF)";
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  // Save file
  const filename = `${Date.now()}-${file.name}`;
  const filepath = path.join(process.cwd(), "public", "uploads", filename);
  
  const writeStream = createWriteStream(filepath);
  if (file.stream) {
    await writeAsyncIterableToWritable(file.stream(), writeStream);
  }

  return {
    success: true,
    filename,
    url: `/uploads/${filename}`
  };
}

export default function FileUpload() {
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <Form method="post" encType="multipart/form-data">
        <div>
          <label htmlFor="file">Choose file</label>
          <input type="file" name="file" accept="image/*" required />
          {actionData?.errors?.file && (
            <p className="error">{actionData.errors.file}</p>
          )}
        </div>
        
        <button type="submit">Upload</button>
      </Form>

      {actionData?.success && (
        <div>
          <p>File uploaded successfully!</p>
          <img src={actionData.url} alt="Uploaded file" style={{ maxWidth: 200 }} />
        </div>
      )}
    </div>
  );
}
```

## Real-time Features

### Server-Sent Events for Live Updates

```typescript
// app/live-data.tsx
import { Route } from "./+types/live-data";
import { useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";

export async function loader() {
  return {
    data: await getCurrentData(),
    timestamp: Date.now()
  };
}

export default function LiveData() {
  const loaderData = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  useEffect(() => {
    const eventSource = new EventSource("/api/live-updates");
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "data-update") {
        revalidator.revalidate();
      }
    };

    return () => {
      eventSource.close();
    };
  }, [revalidator]);

  return (
    <div>
      <h1>Live Data</h1>
      <p>Last updated: {new Date(loaderData.timestamp).toLocaleTimeString()}</p>
      <pre>{JSON.stringify(loaderData.data, null, 2)}</pre>
      
      {revalidator.state === "loading" && (
        <p>Updating...</p>
      )}
    </div>
  );
}
```

## Error Handling

### Comprehensive Error Boundary

```typescript
// app/products/$id.tsx
import { Route } from "./+types/$id";
import { isRouteErrorResponse, useRouteError } from "react-router";

export async function loader({ params }: Route.LoaderArgs) {
  const product = await getProduct(params.id);
  
  if (!product) {
    throw new Response("Product not found", {
      status: 404,
      statusText: "Product not found"
    });
  }
  
  return { product };
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return (
        <div className="error-page">
          <h1>Product Not Found</h1>
          <p>The product you're looking for doesn't exist.</p>
          <Link to="/products">← Back to Products</Link>
        </div>
      );
    }

    if (error.status === 403) {
      return (
        <div className="error-page">
          <h1>Access Denied</h1>
          <p>You don't have permission to view this product.</p>
        </div>
      );
    }

    return (
      <div className="error-page">
        <h1>Error {error.status}</h1>
        <p>{error.statusText || error.data}</p>
      </div>
    );
  }

  let errorMessage = "Unknown error";
  if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <div className="error-page">
      <h1>Something went wrong</h1>
      <p>{errorMessage}</p>
      <button onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  );
}

export default function Product({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <h1>{loaderData.product.name}</h1>
      <p>${loaderData.product.price}</p>
    </div>
  );
}
```

## API Integration

### External API with Caching

```typescript
// app/weather.tsx
import { Route } from "./+types/weather";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || "New York";
  
  // Cache key for this request
  const cacheKey = `weather-${city}`;
  
  // Try to get from cache first
  const cached = await getCachedData(cacheKey);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return { weather: cached.data, city, fromCache: true };
  }
  
  // Fetch from API
  try {
    const response = await fetch(
      `https://api.weather.com/v1/current?city=${encodeURIComponent(city)}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.WEATHER_API_KEY}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const weather = await response.json();
    
    // Cache the result
    await setCachedData(cacheKey, {
      data: weather,
      timestamp: Date.now()
    });
    
    return { weather, city, fromCache: false };
    
  } catch (error) {
    // If API fails, return cached data if available
    if (cached) {
      return { weather: cached.data, city, fromCache: true, stale: true };
    }
    
    throw new Error("Unable to fetch weather data");
  }
}

export default function Weather({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <h1>Weather in {loaderData.city}</h1>
      <p>Temperature: {loaderData.weather.temperature}°F</p>
      <p>Conditions: {loaderData.weather.conditions}</p>
      
      {loaderData.fromCache && (
        <p className="cache-notice">
          {loaderData.stale ? "(Showing cached data - API unavailable)" : "(Cached data)"}
        </p>
      )}
    </div>
  );
}
```

## Performance Patterns

### Optimistic UI Updates

```typescript
// app/todos/index.tsx
import { Route } from "./+types/index";
import { Form, useFetcher } from "react-router";

export async function loader() {
  return { todos: await getTodos() };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  
  if (intent === "create") {
    const text = formData.get("text") as string;
    await createTodo({ text });
  } else if (intent === "toggle") {
    const id = formData.get("id") as string;
    await toggleTodo(id);
  }
  
  return null; // Revalidate automatically
}

export default function Todos({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  
  // Optimistic updates: show pending state
  const isAdding = fetcher.formData?.get("intent") === "create";
  const newTodoText = fetcher.formData?.get("text") as string;

  return (
    <div>
      <h1>Todos</h1>
      
      <fetcher.Form method="post">
        <input name="text" placeholder="Add todo..." required />
        <button 
          type="submit" 
          name="intent" 
          value="create"
          disabled={fetcher.state === "submitting"}
        >
          {isAdding ? "Adding..." : "Add Todo"}
        </button>
      </fetcher.Form>

      <ul>
        {/* Show optimistic new todo */}
        {isAdding && newTodoText && (
          <li className="pending">
            <input type="checkbox" disabled />
            <span>{newTodoText}</span>
          </li>
        )}
        
        {loaderData.todos.map((todo) => (
          <li key={todo.id}>
            <fetcher.Form method="post" style={{ display: "inline" }}>
              <input type="hidden" name="id" value={todo.id} />
              <button
                type="submit"
                name="intent"
                value="toggle"
                style={{ background: "none", border: "none" }}
              >
                <input 
                  type="checkbox" 
                  checked={todo.completed} 
                  readOnly 
                />
              </button>
            </fetcher.Form>
            <span className={todo.completed ? "completed" : ""}>
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

These patterns provide solid foundations for most React Router 7 applications. Each pattern emphasizes the framework's core principles: server-first architecture, progressive enhancement, and type safety.