import { stripClaudeOneMMarker, resolveChatModel } from '../../public/model-selection.js';
import { defaultFetchFor } from '../official-client-http.mjs';
import {
  isManagerPartition,
  isClonePartition,
  workerPartitions,
  clonePartitions,
  freezeManager,
} from '../core.mjs';
import {
  loadTranscript,
  publicTranscript,
  saveTranscript,
  appendMessage,
  HitlBus,
  loadGroupTimeline,
  saveGroupTimeline,
  appendGroupEvent,
  upsertTaskEvent,
  abortTaskEvents,
} from './store.mjs';
import { pickVendor, pickFamily, runTurn, vendorLabel, groupLabel, cycleMode } from './loop.mjs';
import { normalizeMode, isFullAccess } from './permissions.mjs';
import { abortWorkspaceCommands } from './workspace-io.mjs';
import { sseWriter } from './stream.mjs';
import { capabilityPool, cloneStatus, preferActiveRoute, resolveCloneSlot, resolveDispatchTarget } from './dispatch.mjs';
import { measureContext, resolveContextWindow } from './compact.mjs';

export const hitl = new HitlBus();
const runs = new Map();
const sessionListeners = new Map();

function resolveTarget(session, partitionId) {
  const id = String(partitionId || '');
  if (!id) return { isManager: true, partition: null };
  const partition = (session.partitions || []).find(p => p.id === id);
  if (!partition) throw new Error('分区不存在');
  if (isManagerPartition(partition)) return { isManager: true, partition };
  return { isManager: false, partition, isClone: isClonePartition(partition) };
}

function targetKey(isManager, partitionId) {
  return isManager ? 'manager' : `partition-${partitionId}`;
}

function runKey(sessionId, isManager, partitionId) {
  return `${sessionId}:${targetKey(isManager, partitionId)}`;
}

export function busyPartitionIds(sessionId) {
  const ids = new Set();
  const prefix = `${sessionId}:partition-`;
  for (const key of runs.keys()) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return ids;
}

function findSession(state, sessionId) {
  return (state.projects || []).flatMap(p => (p.sessions || []).map(s => ({ project: p, session: s }))).find(x => x.session.id === sessionId) || null;
}

function hydrateConnection(connection, state) {
  if (!connection) return connection;
  const official = state.officialModelConfigs?.[connection.id];
  if (!official) return connection;
  return { ...connection, modelConfigs: { ...official, ...(connection.modelConfigs || {}) } };
}

function lookupConnectionRoute(connectionId, model, state, statuses, hasSecret) {
  if (String(connectionId).startsWith('official-')) {
    const connection = (statuses() || []).find(c => c.id === connectionId);
    if (connection?.connected && !connection.expired) {
      return { connectionId, model, kind: 'official', connection: hydrateConnection(connection, state) };
    }
    return null;
  }
  const connection = (state.connections || []).find(c => c.id === connectionId);
  if (connection && hasSecret(connection.id)) {
    return { connectionId, model, kind: 'custom', connection: hydrateConnection(connection, state) };
  }
  return null;
}

function pickRoute(partition, state, statuses, hasSecret) {
  const pool = capabilityPool(state, statuses, hasSecret);
  for (const route of partition.routes || []) {
    const preferred = preferActiveRoute(pool, route.connectionId);
    const connectionId = preferred?.connectionId || route.connectionId;
    const model = preferred?.model || route.model;
    const found = lookupConnectionRoute(connectionId, model, state, statuses, hasSecret);
    if (!found) continue;
    if (connectionId !== route.connectionId || model !== route.model) {
      partition.routes = [{ connectionId, model }];
      found.rerouted = true;
    }
    return found;
  }
  throw new Error('分区没有可用的模型连接');
}

function pickManager(manager, state, statuses, hasSecret) {
  if (!manager?.connectionId || !manager.model) throw new Error('请先选择管理者 AI');
  const extra = {};
  if (Object.prototype.hasOwnProperty.call(manager, 'effort')) extra.effort = manager.effort || '';
  if (Object.prototype.hasOwnProperty.call(manager, 'contextWindow')) extra.contextWindow = manager.contextWindow;
  if (String(manager.connectionId).startsWith('official-')) {
    const connection = statuses().find(c => c.id === manager.connectionId);
    if (!connection?.connected || connection.expired) throw new Error('管理者官方账号未登录或已过期');
    return { connectionId: manager.connectionId, model: manager.model, kind: 'official', connection: hydrateConnection(connection, state), ...extra };
  }
  const connection = (state.connections || []).find(c => c.id === manager.connectionId);
  if (!connection || !hasSecret(connection.id)) throw new Error('管理者自定义连接不可用');
  return { connectionId: manager.connectionId, model: manager.model, kind: 'custom', connection: hydrateConnection(connection, state), ...extra };
}

async function authFor(route, { officialAccessToken, officialTokenRecord, loadSecret }) {
  if (route.kind === 'official') {
    const accessToken = await officialAccessToken(route.connectionId);
    const stored = officialTokenRecord(route.connectionId) || {};
    return { accessToken, accountID: stored.accountID || stored.account_id, apiKey: '', protocol: '', baseUrl: '' };
  }
  return {
    accessToken: '',
    accountID: '',
    apiKey: loadSecret(route.connectionId),
    protocol: route.connection.protocol,
    baseUrl: route.connection.baseUrl,
  };
}

function connectionOf(state, id) {
  if (!id) return { id: '' };
  return (state.connections || []).find(c => c.id === id) || { id };
}

function labelOf(state, id, vendor) {
  return groupLabel(connectionOf(state, id)) || vendorLabel(vendor);
}

function familyOf(state, isManager, partition) {
  const id = isManager ? state.manager?.connectionId : partition?.routes?.[0]?.connectionId;
  return pickFamily(connectionOf(state, id));
}

function actorContextWindow(state, isManager, partition) {
  if (isManager) {
    const manager = state.manager || {};
    return resolveContextWindow({
      contextWindow: manager.contextWindow,
      connection: hydrateConnection(connectionOf(state, manager.connectionId), state),
      model: manager.model,
    });
  }
  const route = partition?.routes?.[0] || {};
  return resolveContextWindow({
    connection: hydrateConnection(connectionOf(state, route.connectionId), state),
    model: route.model,
  });
}

export function snapshotActorContext(state, isManager, partition, transcript) {
  return measureContext({
    messages: transcript?.messages || [],
    window: actorContextWindow(state, isManager, partition),
  });
}

function abortKey(sessionId, key) {
  const run = runs.get(key);
  if (!run) return null;
  run.controller.abort();
  if (run.workspace) abortWorkspaceCommands(run.workspace);
  hitl.cancelSession(sessionId, key.slice(String(sessionId).length + 1));
  runs.delete(key);
  return run;
}

function abortRun(sessionId, isManager, partitionId) {
  return abortKey(sessionId, runKey(sessionId, isManager, partitionId));
}

function abortSessionRuns(sessionId, { scope, partitionId, isManager } = {}) {
  const prefix = `${sessionId}:`;
  const aborted = [];
  if (scope === 'group') {
    for (const key of [...runs.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const run = abortKey(sessionId, key);
      if (run) aborted.push(run);
    }
    return aborted;
  }
  const key = runKey(sessionId, Boolean(isManager), partitionId);
  const run = abortKey(sessionId, key);
  return run ? [run] : aborted;
}

function publishAbortedTasks(dataDir, sessionId, predicate) {
  if (!dataDir) return [];
  const { result } = mutateGroup(dataDir, sessionId, tl => abortTaskEvents(tl, predicate));
  for (const ev of result || []) emitSession(sessionId, 'group_event', ev);
  return result || [];
}

function subscribeSession(sessionId, sse) {
  if (!sessionListeners.has(sessionId)) sessionListeners.set(sessionId, new Set());
  sessionListeners.get(sessionId).add(sse);
  return () => {
    const set = sessionListeners.get(sessionId);
    if (!set) return;
    set.delete(sse);
    if (!set.size) sessionListeners.delete(sessionId);
  };
}

function emitSession(sessionId, event, data) {
  for (const sse of sessionListeners.get(sessionId) || []) {
    try { sse.send(event, data); } catch { /* closed */ }
  }
}

function fanout(sessionId, localEmit, event, data) {
  try { localEmit?.(event, data); } catch { /* closed */ }
  emitSession(sessionId, event, data);
}

function mutateGroup(dataDir, sessionId, mutator) {
  const timeline = loadGroupTimeline(dataDir, sessionId);
  const result = mutator(timeline);
  saveGroupTimeline(dataDir, sessionId, timeline);
  return { timeline, result };
}

function parseHitlApproved(body) {
  if (body.answers != null) return true;
  const value = body.approved;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new Error('请明确允许或拒绝');
}

export function handleHitl(body) {
  const id = String(body.approvalId || body.id || '');
  if (!id) throw new Error('缺少审批 id');
  return hitl.resolve(id, {
    approved: parseHitlApproved(body),
    reason: String(body.reason || ''),
    answers: body.answers,
  });
}

export function handleHistory({ dataDir, state }, body) {
  const sessionId = String(body.sessionId || '');
  const found = findSession(state, sessionId);
  if (!found) throw new Error('会话不存在');
  const partitionId = String(body.partitionId || '');
  const target = resolveTarget(found.session, partitionId);
  const vendor = familyOf(state, target.isManager, target.partition);
  const transcript = loadTranscript(dataDir, sessionId, targetKey(target.isManager, partitionId), vendor);
  const pending = hitl.list(sessionId);
  const selfKey = targetKey(target.isManager, partitionId);
  const cloneKeys = target.isManager
    ? clonePartitions(found.session).map(p => targetKey(false, p.id))
    : [];
  const pendingHitl = pending.find(a => a.targetId === selfKey || cloneKeys.includes(a.targetId)) || null;
  let hitlPayload = null;
  let questionPayload = null;
  if (pendingHitl?.kind === 'ask' && pendingHitl.args?.questions) {
    questionPayload = { id: pendingHitl.id, questions: pendingHitl.args.questions };
  } else if (pendingHitl) {
    hitlPayload = pendingHitl;
  }
  return {
    ...publicTranscript(transcript),
    vendor: transcript.vendor || vendor,
    vendorLabel: labelOf(state, target.isManager ? state.manager?.connectionId : target.partition?.routes?.[0]?.connectionId, transcript.vendor || vendor),
    target: target.isManager ? 'manager' : (target.isClone ? 'clone' : 'partition'),
    timezone: found.session.timezone || '',
    hitl: hitlPayload,
    question: questionPayload,
    context: snapshotActorContext(state, target.isManager, target.partition, transcript),
  };
}

export function handleGroupHistory({ dataDir, state }, body) {
  const sessionId = String(body.sessionId || '');
  const found = findSession(state, sessionId);
  if (!found) throw new Error('会话不存在');
  const timeline = loadGroupTimeline(dataDir, sessionId);
  const vendor = familyOf(state, true, null);
  const transcript = loadTranscript(dataDir, sessionId, 'manager', vendor);
  return {
    events: timeline.events || [],
    busy: [...busyPartitionIds(sessionId)],
    context: snapshotActorContext(state, true, null, transcript),
    mode: transcript.mode || '',
    vendor,
    vendorLabel: labelOf(state, state.manager?.connectionId, vendor),
  };
}

export function handleMode({ dataDir, state }, body) {
  const sessionId = String(body.sessionId || '');
  const found = findSession(state, sessionId);
  if (!found) throw new Error('会话不存在');
  const partitionId = String(body.partitionId || '');
  const target = resolveTarget(found.session, partitionId);
  const vendor = familyOf(state, target.isManager, target.partition);
  const key = targetKey(target.isManager, partitionId);
  const transcript = loadTranscript(dataDir, sessionId, key, vendor);
  transcript.mode = body.cycle ? cycleMode(vendor, transcript.mode) : normalizeMode(vendor, body.mode);
  saveTranscript(dataDir, sessionId, key, transcript);
  return { mode: transcript.mode, vendor, vendorLabel: labelOf(state, target.isManager ? state.manager?.connectionId : target.partition?.routes?.[0]?.connectionId, vendor) };
}

export function handleAbort(deps, body) {
  const dataDir = deps?.dataDir;
  const state = deps?.state;
  const sessionId = String(body.sessionId || '');
  const partitionId = String(body.partitionId || '');
  const scope = body.scope === 'group' ? 'group' : 'target';
  let isManager = !partitionId;
  if (state && partitionId) {
    const found = findSession(state, sessionId);
    if (found) {
      try { isManager = resolveTarget(found.session, partitionId).isManager; }
      catch { isManager = false; }
    }
  }
  abortSessionRuns(sessionId, { scope, partitionId, isManager });
  const changed = publishAbortedTasks(dataDir, sessionId, ev => {
    if (scope === 'group') return true;
    return Boolean(partitionId) && ev.partitionId === partitionId && !isManager;
  });
  return { ok: true, aborted: changed.length };
}

export function handleSessionEvents(deps, query, req, res) {
  const sessionId = String(query.get?.('sessionId') || query.sessionId || '');
  if (!sessionId) throw new Error('缺少会话');
  const found = findSession(deps.state, sessionId);
  if (!found) throw new Error('会话不存在');
  const sse = sseWriter(res);
  const unsub = subscribeSession(sessionId, sse);
  const timeline = loadGroupTimeline(deps.dataDir, sessionId);
  sse.send('group_timeline', { events: timeline.events || [], busy: [...busyPartitionIds(sessionId)] });
  const ping = setInterval(() => {
    try { sse.send('ping', {}); } catch { /* closed */ }
  }, 15000);
  const close = () => {
    clearInterval(ping);
    unsub();
  };
  req.on('close', close);
  req.on('end', close);
}

export async function handleChat(deps, body, req, res) {
  const { dataDir, state, statuses, hasSecret, officialAccessToken, officialTokenRecord, loadSecret, persist } = deps;
  const sessionId = String(body.sessionId || '');
  const found = findSession(state, sessionId);
  if (!found) throw new Error('会话不存在');
  const text = String(body.text || '').trim();
  if (!text) throw new Error('请输入消息');
  const partitionId = String(body.partitionId || '');
  const target = resolveTarget(found.session, partitionId);
  const isManager = target.isManager;
  const isClone = Boolean(target.isClone);
  let route;
  if (isManager) {
    const frozen = freezeManager(state.manager);
    route = pickManager(frozen, state, statuses, hasSecret);
  } else {
    route = pickRoute(target.partition, state, statuses, hasSecret);
    if (route.rerouted) persist?.();
  }
  if (route.kind === 'official' && deps.refreshOfficialIfNeeded) {
    await deps.refreshOfficialIfNeeded(route.connectionId);
  }

  const vendor = pickVendor(route.connection);
  const family = pickFamily(route.connection);
  const resolved = resolveChatModel(
    route.connection,
    route.model,
    route.effort !== undefined ? { effort: route.effort } : {}
  );
  const model = vendor === 'claude' ? stripClaudeOneMMarker(resolved.model) : String(resolved.model || route.model || '').trim();
  const key = runKey(sessionId, isManager, partitionId);
  abortRun(sessionId, isManager, partitionId);
  const controller = new AbortController();
  const sse = sseWriter(res);
  req.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  const thisTarget = targetKey(isManager, partitionId);
  const onHitl = approval => {
    if (approval.sessionId === sessionId && approval.targetId === thisTarget) sse.send('hitl_request', approval);
  };
  hitl.on('request', onHitl);
  runs.set(key, { controller, sse, manager: isManager ? freezeManager(route) : null, workspace: found.project.path });

  const transcript = loadTranscript(dataDir, sessionId, targetKey(isManager, partitionId), family);
  const emit = (event, data) => {
    try { sse.send(event, data); } catch { /* closed */ }
  };

  const buildCtx = async (partRoute, partId, partTranscript, managerFlag, extra = {}) => {
    const partVendor = pickVendor(partRoute.connection);
    const partResolved = resolveChatModel(partRoute.connection, partRoute.model);
    const partAuth = await authFor(partRoute, { officialAccessToken, officialTokenRecord, loadSecret });
    const partModel = partVendor === 'claude' ? stripClaudeOneMMarker(partResolved.model) : partResolved.model || partRoute.model;
    return {
      vendor: partVendor,
      model: partModel,
      effort: extra.effort || partResolved.effort || body.effort || '',
      contextWindow: resolveContextWindow({
        contextWindow: extra.contextWindow ?? partRoute.contextWindow,
        connection: partRoute.connection,
        model: partModel,
      }),
      workspace: found.project.path,
      timezone: found.session.timezone || '',
      sessionId,
      targetId: targetKey(managerFlag, partId),
      isManager: managerFlag,
      isClone: Boolean(extra.isClone),
      partitions: workerPartitions(found.session),
      pool: capabilityPool(state, statuses, hasSecret),
      cloneStatus: cloneStatus(found.session, busyPartitionIds(sessionId)),
      protocol: partAuth.protocol,
      connection: partRoute.connection,
      transcript: partTranscript,
      dataDir,
      accessToken: partAuth.accessToken,
      accountID: partAuth.accountID,
      apiKey: partAuth.apiKey,
      baseUrl: partAuth.baseUrl,
      fetcher: partRoute.kind === 'official' ? defaultFetchFor(partRoute.connectionId) : fetch,
      abortSignal: extra.abortSignal || controller.signal,
      hitl,
      emit: extra.emit || emit,
      depth: extra.depth || 0,
      allowOutside: Boolean(extra.allowOutside) || isFullAccess(partVendor, extra.mode || partTranscript.mode),
      maxTurns: extra.maxTurns || 24,
    };
  };

  const publishGroup = (event, payload) => fanout(sessionId, emit, event, payload);

  const writeTask = (taskId, patch) => {
    const { result } = mutateGroup(dataDir, sessionId, tl => upsertTaskEvent(tl, taskId, patch));
    publishGroup('group_event', result);
    return result;
  };

  const publishPartitions = () => {
    persist?.();
    emitSession(sessionId, 'session_update', { partitions: found.session.partitions });
  };

  let liveTaskId = '';
  let ctx;

  const publishWorkerReturn = ({ partition, taskId, status, summary, clone, model, slot, toManager = true }) => {
    const text = String(summary || '').slice(0, 4000);
    writeTask(taskId, { status, summary: text, source: clone ? 'clone' : (toManager ? 'manager' : 'user') });
    if (clone) {
      const managerVendor = pickFamily(connectionOf(state, state.manager?.connectionId || (partition.routes || [])[0]?.connectionId));
      const managerTranscript = loadTranscript(dataDir, sessionId, 'manager', managerVendor);
      appendMessage(managerTranscript, {
        role: 'assistant',
        content: text,
        kind: 'clone_result',
        model: model || '',
      });
      saveTranscript(dataDir, sessionId, 'manager', managerTranscript);
      emitSession(sessionId, 'clone_result', { partitionId: partition.id, taskId, slot: slot || partition.slot, text });
      return;
    }
    const { result: workerEv } = mutateGroup(dataDir, sessionId, tl => appendGroupEvent(tl, {
      type: 'worker',
      content: text,
      taskId,
      kind: 'execution',
      status,
      name: partition.name,
      vendorLabel: groupLabel(connectionOf(state, (partition.routes || [])[0]?.connectionId)) || partition.name,
      partitionId: partition.id,
      source: toManager ? 'manager' : 'user',
      summary: text,
    }));
    publishGroup('group_event', workerEv);
    if (!toManager) return;
    const managerVendor = pickFamily(connectionOf(state, state.manager?.connectionId));
    const managerTranscript = loadTranscript(dataDir, sessionId, 'manager', managerVendor);
    appendMessage(managerTranscript, {
      role: 'assistant',
      content: text,
      kind: 'dispatch_result',
      name: partition.name,
      status,
      model: model || '',
    });
    saveTranscript(dataDir, sessionId, 'manager', managerTranscript);
    emitSession(sessionId, 'dispatch_result', {
      partitionId: partition.id,
      taskId,
      name: partition.name,
      status,
      text,
    });
  };

  const recordPartitionError = (partition, summary, taskId, kind) => {
    try {
      const partVendor = pickFamily(connectionOf(state, (partition.routes || [])[0]?.connectionId));
      const partTranscript = loadTranscript(dataDir, sessionId, targetKey(false, partition.id), partVendor);
      const message = appendMessage(partTranscript, {
        role: 'assistant',
        content: summary,
        kind: 'job_error',
      });
      saveTranscript(dataDir, sessionId, targetKey(false, partition.id), partTranscript);
      emitSession(sessionId, 'agent_done', { message, partitionId: partition.id, taskId, via: kind });
      emitSession(sessionId, 'error', { error: summary, partitionId: partition.id, taskId, via: kind });
    } catch { /* keep task status */ }
  };

  const startBackgroundJob = ({ partition, prompt, taskId, kind }) => {
    const clone = kind === 'clone';
    const jobController = new AbortController();
    const jobKey = runKey(sessionId, false, partition.id);
    abortRun(sessionId, false, partition.id);
    runs.set(jobKey, { controller: jobController, sse: null, kind, taskId, partitionId: partition.id, workspace: found.project.path });
    const jobTarget = targetKey(false, partition.id);
    const jobEmit = (event, data) => {
      const payload = { ...data, partitionId: partition.id, taskId, via: kind };
      emitSession(sessionId, event, payload);
      if (event === 'hitl_request') writeTask(taskId, { status: 'waiting', summary: data.summary || '等待确认' });
      if (event === 'hitl_resolved') {
        writeTask(taskId, {
          status: 'running',
          summary: data.approved === false ? (data.reason || '已拒绝') : '继续执行',
        });
      }
    };
    const onJobHitl = approval => {
      if (approval.sessionId === sessionId && approval.targetId === jobTarget) jobEmit('hitl_request', approval);
    };
    hitl.on('request', onJobHitl);
    setImmediate(() => {
      (async () => {
        try {
          const partRoute = pickRoute(partition, state, statuses, hasSecret);
          if (partRoute.rerouted) publishPartitions();
          if (partRoute.kind === 'official' && deps.refreshOfficialIfNeeded) {
            await deps.refreshOfficialIfNeeded(partRoute.connectionId);
          }
          const partFamily = pickFamily(partRoute.connection);
          const partTranscript = loadTranscript(dataDir, sessionId, targetKey(false, partition.id), partFamily);
          const child = await buildCtx(partRoute, partition.id, partTranscript, false, {
            depth: 1,
            isClone: clone,
            abortSignal: jobController.signal,
            emit: jobEmit,
            maxTurns: 24,
          });
          child.userText = String(prompt || '');
          const result = await runTurn(child);
          const summary = String(result.text || '').slice(0, 4000);
          publishWorkerReturn({
            partition,
            taskId,
            status: 'completed',
            summary,
            clone,
            model: child.model,
            slot: partition.slot,
          });
        } catch (error) {
          const aborted = jobController.signal.aborted || error?.name === 'AbortError';
          const summary = aborted ? '被用户中止' : (error.message || String(error));
          publishWorkerReturn({
            partition,
            taskId,
            status: 'failed',
            summary,
            clone,
            slot: partition.slot,
          });
          if (!clone) recordPartitionError(partition, summary, taskId, kind);
        } finally {
          hitl.off('request', onJobHitl);
          runs.delete(jobKey);
        }
      })();
    });
  };

  try {
    ctx = await buildCtx(route, partitionId, transcript, isManager, {
      effort: resolved.effort,
      isClone,
      abortSignal: controller.signal,
      contextWindow: route.contextWindow,
    });
    ctx.userText = text;
    ctx.listTargets = () => ({
      ok: true,
      pool: capabilityPool(state, statuses, hasSecret),
      executions: workerPartitions(found.session).map(p => ({
        id: p.id,
        name: p.name,
        key: p.key,
        routes: p.routes,
        running: busyPartitionIds(sessionId).has(p.id),
      })),
      clones: cloneStatus(found.session, busyPartitionIds(sessionId)),
    });
    ctx.dispatchWork = spec => {
      const prompt = String(spec.prompt || '').trim();
      if (!prompt) return { ok: false, error: '缺少任务内容' };
      const busyIds = busyPartitionIds(sessionId);
      const resolvedTarget = resolveDispatchTarget({
        session: found.session,
        state,
        statuses,
        hasSecret,
        connectionId: spec.connectionId,
        partitionId: spec.partitionId,
        model: spec.model,
        busyIds,
        prompt,
      });
      if (!resolvedTarget.ok) return resolvedTarget;
      publishPartitions();
      const taskId = crypto.randomUUID();
      const part = resolvedTarget.partition;
      const partVendor = pickVendor({ id: (part.routes || [])[0]?.connectionId });
      writeTask(taskId, {
        kind: 'execution',
        status: 'running',
        name: part.name,
        vendor: partVendor,
        vendorLabel: resolvedTarget.vendorLabel || vendorLabel(partVendor),
        partitionId: part.id,
        source: 'manager',
        summary: prompt.slice(0, 240),
        content: prompt.slice(0, 240),
      });
      startBackgroundJob({ partition: part, prompt, taskId, kind: 'execution' });
      return { ok: true, status: 'running', taskId, partitionId: part.id, name: part.name };
    };
    ctx.spawnClone = spec => {
      const prompt = String(spec.prompt || '').trim();
      if (!prompt) return { ok: false, error: '缺少分身任务' };
      const busyIds = busyPartitionIds(sessionId);
      const slot = resolveCloneSlot({
        session: found.session,
        connectionId: route.connectionId,
        model: route.model,
        busyIds,
      });
      if (!slot.ok) return slot;
      publishPartitions();
      const taskId = crypto.randomUUID();
      const part = slot.partition;
      writeTask(taskId, {
        kind: 'clone',
        status: 'running',
        name: part.name,
        vendor,
        vendorLabel: groupLabel(route.connection) || vendorLabel(vendor),
        partitionId: part.id,
        slot: part.slot,
        source: 'clone',
        summary: prompt.slice(0, 240),
        content: prompt.slice(0, 240),
      });
      startBackgroundJob({ partition: part, prompt, taskId, kind: 'clone' });
      return { ok: true, status: 'running', taskId, partitionId: part.id, slot: part.slot, name: part.name };
    };
    ctx.dispatchPartition = (id, prompt) => ctx.dispatchWork({ partitionId: id, prompt });

    if (isManager && !isClone) {
      const { result: userEvent } = mutateGroup(dataDir, sessionId, tl => appendGroupEvent(tl, { type: 'user', content: text }));
      publishGroup('group_event', userEvent);
    } else if (!isClone) {
      liveTaskId = crypto.randomUUID();
      const name = target.partition?.name || '执行';
      const { result: note } = mutateGroup(dataDir, sessionId, tl => appendGroupEvent(tl, {
        type: 'note',
        content: `用户直接向 ${name} 下达了：${text.slice(0, 160)}`,
        partitionId: target.partition?.id || partitionId,
        source: 'user',
      }));
      publishGroup('group_event', note);
      writeTask(liveTaskId, {
        kind: 'execution',
        status: 'running',
        name,
        vendor,
        vendorLabel: groupLabel(route.connection) || vendorLabel(vendor),
        partitionId: target.partition?.id || partitionId,
        source: 'user',
        summary: text.slice(0, 240),
        content: text.slice(0, 240),
      });
      const current = runs.get(key);
      if (current) current.taskId = liveTaskId;
    }

    emit('chat_start', { vendor: family, vendorLabel: groupLabel(route.connection) || vendorLabel(family), model, mode: transcript.mode, target: isManager ? 'manager' : (isClone ? 'clone' : 'partition') });
    const result = await runTurn(ctx);
    if (isManager && !isClone && result?.text) {
      const { result: mgrEvent } = mutateGroup(dataDir, sessionId, tl => appendGroupEvent(tl, {
        id: result.message?.id,
        type: 'manager',
        content: result.text,
        vendorLabel: groupLabel(route.connection) || vendorLabel(family),
        model,
      }));
      publishGroup('group_event', mgrEvent);
    }
    if (liveTaskId && target.partition) {
      const aborted = controller.signal.aborted;
      publishWorkerReturn({
        partition: target.partition,
        taskId: liveTaskId,
        status: aborted ? 'failed' : 'completed',
        summary: aborted ? '被用户中止' : String(result?.text || '').slice(0, 4000),
        clone: false,
        model,
        toManager: false,
      });
    }
  } catch (error) {
    if (ctx?.transcript) {
      try { saveTranscript(dataDir, sessionId, targetKey(isManager, partitionId), ctx.transcript); } catch { /* keep */ }
    }
    emit('error', { error: error.message || String(error) });
    if (isManager && !isClone) {
      const { result: note } = mutateGroup(dataDir, sessionId, tl => appendGroupEvent(tl, {
        type: 'note',
        content: `管理者本轮失败：${error.message || String(error)}`,
      }));
      publishGroup('group_event', note);
    }
    if (liveTaskId && target.partition) {
      const aborted = controller.signal.aborted || error?.name === 'AbortError';
      publishWorkerReturn({
        partition: target.partition,
        taskId: liveTaskId,
        status: 'failed',
        summary: aborted ? '被用户中止' : (error.message || String(error)),
        clone: false,
        toManager: false,
      });
    }
  } finally {
    hitl.off('request', onHitl);
    runs.delete(key);
    emit('done', {});
    sse.end();
  }
}
