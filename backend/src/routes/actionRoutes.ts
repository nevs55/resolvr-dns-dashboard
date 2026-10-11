import { Router, type Request, type Response } from "express";

// Read-only mode: this dashboard performs NO mutating Technitium actions.
//
// Every former admin action — flush DNS cache, force a block-list update,
// edit block-list feeds, block/unblock a domain, uninstall an app, create
// or delete a zone, add a record, revoke a session — is now rejected with
// 403 for every caller, admins included, and no request here ever reaches
// the DNS server.
//
// The mutating helper that used to back these routes
// (callTechnitiumAction) has been quarantined out of the compiled runtime:
// see backend/quarantine/technitiumAction.ts. Nothing in src/ imports it.
//
// The router stays mounted (app.ts) so a stale client still pointing at an
// old action URL fails closed with an explicit read-only error instead of
// a misleading 404 — and so the read-only guarantee is enforced in exactly
// one place, independent of what the frontend happens to render.
export function actionRoutes(): Router {
  const router = Router();

  router.use((_req: Request, res: Response) => {
    res.status(403).json({
      error:
        "This dashboard is read-only and no longer performs any changes on the Technitium server.",
    });
  });

  return router;
}
