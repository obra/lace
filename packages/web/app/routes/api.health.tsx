// ABOUTME: Health check endpoint for server readiness verification
// ABOUTME: Used by E2E tests and monitoring to verify server is responding correctly

export async function loader() {
  try {
    return Response.json(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'lace-web',
        pid: process.pid,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Health check error:', error);
    return Response.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        service: 'lace-web',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
