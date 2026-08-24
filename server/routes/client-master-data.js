const express = require('express');
const { actorWithScope } = require('../lib/trusted-actor-scope');

function sendLifecycleError(res, error) {
  const details = error?.details;
  const blockers = Array.isArray(details?.blockers) ? details.blockers : undefined;
  return res.status(Number(error?.status) || 400).json({
    ok: false,
    code: error?.code || 'MASTER_DATA_LIFECYCLE_FAILED',
    error: error?.message || 'Не удалось выполнить lifecycle operation.',
    ...(details !== undefined ? { details } : {}),
    ...(blockers ? { blockers } : {}),
  });
}

function registerClientMasterDataRoutes({
  lifecycle,
  requireAuth,
  requireRead,
  requireWrite,
}) {
  if (!lifecycle) throw new Error('Client master-data routes require lifecycle service.');
  const router = express.Router();

  router.delete('/clients/:id', requireAuth, requireWrite('clients'), (req, res) => {
    try {
      return res.json(lifecycle.deleteClient({ id: req.params.id, actor: actorWithScope(req) }));
    } catch (error) {
      return sendLifecycleError(res, error);
    }
  });

  router.get(
    '/client_objects/:id/lifecycle',
    requireAuth,
    requireRead('client_objects'),
    (req, res) => {
      try {
        return res.json(lifecycle.getClientObjectLifecycle({ id: req.params.id, actor: actorWithScope(req) }));
      } catch (error) {
        return sendLifecycleError(res, error);
      }
    },
  );

  router.post(
    '/client_objects/:id/archive',
    requireAuth,
    requireWrite('client_objects'),
    (req, res) => {
      try {
        return res.json(lifecycle.archiveClientObject({ id: req.params.id, actor: actorWithScope(req) }));
      } catch (error) {
        return sendLifecycleError(res, error);
      }
    },
  );

  router.delete(
    '/client_objects/:id',
    requireAuth,
    requireWrite('client_objects'),
    (req, res) => {
      try {
        return res.json(lifecycle.deleteClientObject({ id: req.params.id, actor: actorWithScope(req) }));
      } catch (error) {
        return sendLifecycleError(res, error);
      }
    },
  );

  return router;
}

module.exports = {
  registerClientMasterDataRoutes,
  sendLifecycleError,
};
