// Adapted from CC Switch ProviderCard & ProviderActions (MIT, Copyright 2025 Jason Young).
import { icons, esc } from './shell.js';
import { presetIconSrc } from './provider-presets.js';
import { protocolBadge } from './protocols.js';

export function extractModelSummary(connection, group) {
  const config = connection.modelConfigs?.[group] || {};
  const parts = [];
  if (group === 'claude') {
    const env = config.env || {};
    const defaultM = env.ANTHROPIC_MODEL || '';
    if (defaultM) parts.push(`默认: ${defaultM}`);
    if (env.ANTHROPIC_DEFAULT_SONNET_MODEL && env.ANTHROPIC_DEFAULT_SONNET_MODEL !== defaultM) {
      parts.push(`Sonnet: ${env.ANTHROPIC_DEFAULT_SONNET_MODEL}`);
    }
    if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) parts.push(`Haiku: ${env.ANTHROPIC_DEFAULT_HAIKU_MODEL}`);
  } else {
    const defaultM = config.defaultModel || (connection.models?.[0] ?? '');
    if (defaultM) parts.push(`默认: ${defaultM}`);
  }
  if (config.defaultEffort) parts.push(`努力: ${config.defaultEffort}`);
  if (config.contextWindow) parts.push(`上下文 ${config.contextWindow}`);
  const mapCount = config.catalog?.length ?? 0;
  if (mapCount) parts.push(`${mapCount} 个模型`);
  if (parts.length) return parts.join(' · ');
  return connection.models?.length ? `${connection.models.length} 个模型` : '未配置具体模型';
}

function speedBadgeHtml(testResult) {
  if (!testResult) return '';
  if (testResult.loading) {
    return `<span class="cc-speed-badge testing"><span class="cc-spin">⟳</span> 测速中…</span>`;
  }
  if (testResult.error) {
    return `<span class="cc-speed-badge error" title="${esc(testResult.error)}">✕ 失败</span>`;
  }
  return `<span class="cc-speed-badge success">● ${testResult.durationMs ?? 0}ms</span>`;
}

function providerIconHtml(c, activeGroup) {
  const src = c.iconFile ? `/icons/${c.iconFile}` : presetIconSrc(c.icon);
  if (src) {
    const color = c.iconColor ? ` style="color:${esc(c.iconColor)}"` : '';
    return `<div class="cc-card-icon" aria-hidden="true"${color}><img src="${esc(src)}" alt=""></div>`;
  }
  return `<div class="cc-card-icon" aria-hidden="true">${icons[activeGroup] || icons.generic}</div>`;
}

function partnerMark(c) {
  if (c.primePartner) return `<span class="cc-badge partner-heart" title="尊享合作伙伴">${icons.heart}</span>`;
  if (c.isPartner) return `<span class="cc-badge partner-star" title="合作伙伴">${icons.star}</span>`;
  return '';
}

function cardMeta(c) {
  const notes = String(c.notes || '').trim();
  if (notes) return `<span class="muted">${esc(notes)}</span>`;
  const site = String(c.websiteUrl || '').trim();
  if (site) return `<a class="cc-card-url" href="${esc(site)}" target="_blank" rel="noreferrer" title="${esc(site)}">${esc(site)}</a>`;
  if (c.baseUrl) return `<a class="cc-card-url" href="${esc(c.baseUrl)}" target="_blank" rel="noreferrer" title="${esc(c.baseUrl)}">${esc(c.baseUrl)}</a>`;
  return '<span class="cc-card-nourl">未配置接口地址</span>';
}

function inUseBadge(isActive) {
  if (!isActive) return '';
  return `<span class="cc-inuse-badge" aria-label="当前使用的供应商">当前使用</span>`;
}

function enableButton(id, isActive) {
  if (isActive) return '';
  return `<button type="button" class="cc-switch-btn" data-action="switch-provider" data-id="${esc(id)}" title="启用此提供商">
    ${icons.play}<span>启用</span>
  </button>`;
}

export function renderProviderCard(c, activeGroup, isActive = false, testResult = null) {
  const modelSummary = extractModelSummary(c, activeGroup);
  const protocolName = protocolBadge(c.protocol);
  const speedBadge = speedBadgeHtml(testResult);

  return `
    <div class="cc-provider-card ${isActive ? 'active-provider' : ''}" data-provider-id="${esc(c.id)}">
      <div class="cc-card-main">
        ${providerIconHtml(c, activeGroup)}
        <div class="cc-card-info">
          <div class="cc-card-header-row">
            <h3 class="cc-card-title">${esc(c.name)}</h3>
            ${partnerMark(c)}
            ${inUseBadge(isActive)}
            <span class="cc-badge protocol">${esc(protocolName)}</span>
            ${c.hasKey ? '' : '<span class="cc-badge warning">未存密钥</span>'}
          </div>
          <div class="cc-card-meta">${cardMeta(c)}</div>
          <div class="cc-card-models" title="${esc(modelSummary)}">
            <span class="muted">${esc(modelSummary)}</span>
          </div>
        </div>
      </div>
      <div class="cc-card-trailing">
        ${speedBadge}
        <div class="cc-card-actions">
          ${enableButton(c.id, isActive)}
          <button type="button" class="cc-action-btn" data-action="test-provider" data-id="${esc(c.id)}" title="发送 hi 测试" aria-label="向模型发送 hi 并读取返回">
            ${icons.test}
          </button>
          <button type="button" class="cc-action-btn" data-action="edit-provider" data-id="${esc(c.id)}" title="编辑供应商" aria-label="编辑供应商">
            ${icons.edit}
          </button>
          <button type="button" class="cc-action-btn" data-action="copy-provider" data-id="${esc(c.id)}" title="复制为副本" aria-label="复制">
            ${icons.copy}
          </button>
          <button type="button" class="cc-action-btn danger" data-action="delete-provider" data-id="${esc(c.id)}" title="删除供应商" aria-label="删除">
            ${icons.trash}
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderOfficialCard(c, activeGroup, isActive = false, testResult = null) {
  const needsReauth = Boolean(c.authError);
  const isLogged = c.connected && !c.expired;
  const badge = needsReauth ? '授权已失效' : c.expired ? '登录已过期' : isLogged ? '已授权登录' : '未登录';
  const badgeClass = needsReauth ? 'error' : c.expired ? 'warning' : isLogged ? 'ready' : 'neutral';
  const modelSummary = extractModelSummary(c, activeGroup);
  const speedBadge = speedBadgeHtml(testResult);
  const meta = needsReauth
    ? [c.email, c.authError.message || '授权已失效，请重新登录。'].filter(Boolean).join(' · ')
    : isLogged
      ? [c.email, c.credentialSource].filter(Boolean).join(' · ')
      : String(c.description || '').trim();
  return `
    <div class="cc-provider-card official ${isActive ? 'active-provider' : ''}">
      <div class="cc-card-main">
        <div class="cc-card-icon official-icon">${icons[c.id.replace('official-', '')] || icons.ai}</div>
        <div class="cc-card-info">
          <div class="cc-card-header-row">
            <h3 class="cc-card-title">${esc(c.name)}</h3>
            ${isLogged ? inUseBadge(isActive) : ''}
            <span class="cc-badge ${badgeClass}">${badge}</span>
          </div>
          ${meta ? `<div class="cc-card-meta"><span class="muted">${esc(meta)}</span></div>` : ''}
          <div class="cc-card-models" title="${esc(modelSummary)}">
            <span class="muted">${esc(modelSummary)}</span>
          </div>
        </div>
      </div>
      <div class="cc-card-trailing">
        ${speedBadge}
        <div class="cc-card-auth">
          ${!isLogged ? (
            c.loginAvailable === false
              ? `<button type="button" class="secondary cc-login-btn" disabled title="${esc(c.loginDisabledReason || '官方登录暂不可用')}">${esc(c.id === 'official-gemini' ? '未配置 Google 客户端' : '登录待接入')}</button>`
              : `<button type="button" class="primary cc-login-btn" data-action="login" data-id="${esc(c.id)}">登录账号</button>`
          ) : ''}
          ${needsReauth ? `<button type="button" class="secondary cc-logout-btn" data-action="disconnect" data-id="${esc(c.id)}">退出登录</button>` : ''}
        </div>
        <div class="cc-card-actions">
          ${isLogged ? enableButton(c.id, isActive) : ''}
          ${isLogged ? `
          <button type="button" class="cc-action-btn" data-action="test-provider" data-id="${esc(c.id)}" title="发送 hi 测试" aria-label="向模型发送 hi 并读取返回">
            ${icons.test}
          </button>` : ''}
          <button type="button" class="cc-action-btn" data-action="edit-provider" data-id="${esc(c.id)}" title="配置模型" aria-label="配置模型">
            ${icons.edit}
          </button>
          ${isLogged ? `<button type="button" class="secondary cc-login-btn" data-action="login" data-id="${esc(c.id)}">重新登录</button>
          <button type="button" class="secondary cc-logout-btn" data-action="disconnect" data-id="${esc(c.id)}">退出登录</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

export function renderEmptyState(groupName) {
  return `
    <div class="cc-empty-state">
      <div class="cc-empty-icon">${icons.ai}</div>
      <h3>暂无 ${esc(groupName)} 模型提供商</h3>
      <p class="muted">该系列的提供商会出现在这里，每个系列只能启用其中一个。</p>
    </div>
  `;
}
