// Stands in for the `server-only` package during unit tests. In the real app that package makes
// the build fail if server code is ever imported into the browser; tests run only on the server.
export {};
