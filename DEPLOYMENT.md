# Deploy DarshanDisha on Vercel

DarshanDisha is a static browser application. Routing runs in a browser Web Worker, and the map is a bundled JSON asset. The local `server.mjs` is not required in production.

## Import the GitHub repository

1. In Vercel, choose **Add New → Project** and import `SOHAM0007-CODER/DarshanDisha`.
2. Use the repository root as the **Root Directory** (leave the default).
3. Use these settings, which are also declared in `vercel.json`:

   | Setting | Value |
   | --- | --- |
   | Framework Preset | **Other** |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Install Command | Skipped; the app has no package dependencies |
   | Environment Variables | None required |

4. Deploy from the **main** branch. Do not use `npm start` as a build command: it starts a local server and never finishes as a build.

The build copies seven runtime files into `dist/`, including `worker.mjs`, its algorithm module, and `data/map.json`. The Vercel configuration explicitly serves `.mjs` files as JavaScript, including the module worker. There is no catch-all HTML rewrite, so missing module or JSON requests remain real 404s.

## Check the build locally

```bash
npm run build
npm test
```

The `dist/` output is generated and ignored by Git. Vercel creates it during deployment. Keep the bundled map data in the repository; it is needed at build time.

## If a deployment fails

- **Missing build script or wrong output directory:** deploy the latest `main` commit and use the settings above.
- **Build keeps running:** replace a build command of `npm start` with `npm run build`.
- **404 on the homepage:** check the repository root and confirm the build output includes `dist/index.html`.
- **Map never loads:** inspect `/data/map.json`, `/worker.mjs`, and `/engine.mjs` on the deployed URL. They should return their respective JSON or JavaScript files, not HTML.
- **Module MIME type error:** use the committed `vercel.json`, which sets the JavaScript content type for `.mjs`.

For an existing project, clear conflicting dashboard overrides or create a new import using the repository configuration. Share the failing build log or deployed URL when asking for help; no password or access token is needed in a message.

Official documentation: [Vercel build settings](https://vercel.com/docs/builds/configure-a-build) and [vercel.json configuration](https://vercel.com/docs/project-configuration/vercel-json).
