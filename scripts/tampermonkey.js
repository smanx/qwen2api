// ==UserScript==
// @name         通用视频分析面板
// @namespace    https://github.com/smanx/qwen2api
// @version      1.3.0
// @description  在常见视频播放详情页增加分析面板，支持流式输出与日志查看
// @author       hephaestus
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/watchlater/*
// @match        https://www.youtube.com/watch*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'tm_video_analysis_input';
  const DEFAULT_PROMPT = '分析视频内容';
  const SERVER_BASE_KEY = 'tm_video_analysis_server_base';
  const MODEL_KEY = 'tm_video_analysis_model';
  const RESOLUTION_KEY = 'tm_video_analysis_resolution';
  const LAUNCHER_POS_KEY = 'tm_video_analysis_launcher_pos';
  const DEFAULT_MODEL = 'qwen3.5-plus';
  const DEFAULT_RESOLUTION = 'default';
  const DEFAULT_SERVER_BASE = 'http://localhost:8765';
  const PANEL_ID = 'tm-video-analysis-panel';
  const LAUNCHER_ID = 'tm-video-analysis-launcher';
  const SCROLLBAR_STYLE_ID = 'tm-video-analysis-scrollbar-style';
  let lastInitUrl = '';
  let routeObserver = null;
  let resizeHookInstalled = false;
  let bootstrapped = false;

  function ensureScrollbarStyles() {
    if (document.getElementById(SCROLLBAR_STYLE_ID)) {
      return;
    }

    const style = create('style', { id: SCROLLBAR_STYLE_ID });
    style.textContent = `
#${PANEL_ID} [data-scrollable="true"] {
  scrollbar-width: thin;
  scrollbar-color: rgba(107, 114, 128, 0.9) rgba(20, 26, 36, 0.85);
}

#${PANEL_ID} [data-scrollable="true"]::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

#${PANEL_ID} [data-scrollable="true"]::-webkit-scrollbar-track {
  background: linear-gradient(180deg, rgba(25, 31, 42, 0.9), rgba(15, 20, 30, 0.92));
  border-radius: 10px;
}

#${PANEL_ID} [data-scrollable="true"]::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(129, 140, 153, 0.95), rgba(107, 114, 128, 0.95));
  border-radius: 999px;
  border: 2px solid rgba(18, 22, 30, 0.92);
  min-height: 28px;
}

#${PANEL_ID} [data-scrollable="true"]::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(180, 191, 207, 0.98), rgba(148, 163, 184, 0.98));
}

#${PANEL_ID} [data-scrollable="true"]::-webkit-scrollbar-thumb:active {
  background: linear-gradient(180deg, rgba(147, 197, 253, 0.96), rgba(96, 165, 250, 0.96));
}

#${PANEL_ID} [data-scrollable="true"]::-webkit-scrollbar-corner {
  background: rgba(15, 20, 30, 0.9);
}
`;

    const head = document.head || document.documentElement;
    head.appendChild(style);
  }

  function create(tag, props = {}) {
    const el = document.createElement(tag);
    Object.assign(el, props);
    return el;
  }

  function clearNode(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function isSupportedPage() {
    return /^https?:\/\//.test(location.href);
  }

  function buildPanel() {
    const panel = create('div', { id: PANEL_ID });
    panel.style.cssText = [
    'position: fixed',
    'right: 16px',
    'top: 140px',
    'z-index: 999999',
    'width: 360px',
    'max-height: calc(100vh - 120px)',
    'overflow: hidden',
    'padding: 12px',
    'border-radius: 10px',
    'background: rgba(20, 20, 20, 0.92)',
    'color: #fff',
    'font-size: 13px',
    'line-height: 1.4',
    'box-shadow: 0 8px 20px rgba(0,0,0,.35)',
    'display: none'
    ].join(';');

    const title = create('div', { textContent: '视频分析' });
    title.style.cssText = 'font-size:14px;font-weight:700;margin-bottom:8px;';

    const input = create('input');
    input.type = 'text';
    input.placeholder = '请输入内容';
    input.value = localStorage.getItem(STORAGE_KEY) || DEFAULT_PROMPT;
    input.style.cssText = [
    'width: 100%',
    'box-sizing: border-box',
    'border: 1px solid #666',
    'border-radius: 6px',
    'padding: 8px',
    'outline: none',
    'background: #1f1f1f',
    'color: #fff',
    'margin-bottom: 8px'
    ].join(';');

    const serverInput = create('input');
    serverInput.type = 'text';
    serverInput.placeholder = '请输入服务基地址，如 http://localhost:8765';
    serverInput.value = localStorage.getItem(SERVER_BASE_KEY) || DEFAULT_SERVER_BASE;
    serverInput.style.cssText = [
      'width: 100%',
      'box-sizing: border-box',
      'border: 1px solid #666',
      'border-radius: 6px',
      'padding: 8px',
      'outline: none',
      'background: #1f1f1f',
      'color: #fff',
      'margin-bottom: 8px'
    ].join(';');

    const modelRow = create('div');
    modelRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';

    const resolutionRow = create('div');
    resolutionRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';

    const resolutionLabel = create('div', { textContent: '清晰度' });
    resolutionLabel.style.cssText = 'width:56px;color:rgba(255,255,255,.82);font-size:12px;';

    const resolutionSelect = create('select');
    resolutionSelect.style.cssText = [
      'flex: 1',
      'box-sizing: border-box',
      'border: 1px solid #666',
      'border-radius: 6px',
      'padding: 8px',
      'outline: none',
      'background: #1f1f1f',
      'color: #fff'
    ].join(';');

    const storedResolution = localStorage.getItem(RESOLUTION_KEY) || DEFAULT_RESOLUTION;
    const resolutionOptions = [
      { value: 'default', label: '默认(按高度p)' },
      { value: '360', label: '360p' },
      { value: '480', label: '480p' },
      { value: '720', label: '720p' }
    ];
    for (const item of resolutionOptions) {
      const option = create('option', { value: item.value, textContent: item.label });
      option.selected = item.value === storedResolution;
      resolutionSelect.appendChild(option);
    }

    const modelSelect = create('select');
    modelSelect.style.cssText = [
      'flex: 1',
      'box-sizing: border-box',
      'border: 1px solid #666',
      'border-radius: 6px',
      'padding: 8px',
      'outline: none',
      'background: #1f1f1f',
      'color: #fff'
    ].join(';');

    const storedModel = localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
    clearNode(modelSelect);
    modelSelect.appendChild(create('option', { value: storedModel, textContent: storedModel }));

    const reloadModelsButton = create('button', { textContent: '刷新模型' });
    reloadModelsButton.style.cssText = [
      'border: 0',
      'border-radius: 6px',
      'padding: 8px 10px',
      'cursor: pointer',
      'background: #3a3a3a',
      'color: #fff',
      'white-space: nowrap'
    ].join(';');

    const button = create('button', { textContent: '开始分析' });
    button.style.cssText = [
    'width: 100%',
    'border: 0',
    'border-radius: 6px',
    'padding: 8px',
    'cursor: pointer',
    'background: #00a1d6',
    'color: #fff',
    'font-weight: 600',
    'margin-bottom: 10px'
    ].join(';');

    const toggleLogsButton = create('button', { textContent: '展开日志' });
    toggleLogsButton.style.cssText = [
      'width: 100%',
      'border: 0',
      'border-radius: 6px',
      'padding: 8px',
      'cursor: pointer',
      'background: #3a3a3a',
      'color: #fff',
      'font-weight: 600',
      'margin-top: 10px',
      'margin-bottom: 8px'
    ].join(';');

    const logSection = create('div');
    logSection.style.cssText = 'display:none;';

    const statusHeader = create('div');
    statusHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;';

    const statusTitle = create('div', { textContent: '分析过程（流式）' });
    statusTitle.style.cssText = 'font-weight:600;';

    const clearLogsButton = create('button', { textContent: '清空日志' });
    clearLogsButton.style.cssText = [
      'border: 0',
      'border-radius: 6px',
      'padding: 6px 10px',
      'cursor: pointer',
      'background: #3a3a3a',
      'color: #fff',
      'font-size: 12px'
    ].join(';');

    const statusList = create('div');
    statusList.dataset.scrollable = 'true';
    statusList.style.cssText = [
    'border: 1px solid #555',
    'border-radius: 6px',
    'padding: 6px',
    'height: 180px',
    'overflow: auto',
    'white-space: pre-wrap',
    'word-break: break-all',
    'background: #111',
    'margin-bottom: 10px'
    ].join(';');

    const outputTitle = create('div', { textContent: '分析结果' });
    outputTitle.style.cssText = 'font-weight:600;margin-bottom:6px;';

    const output = create('textarea');
    output.dataset.scrollable = 'true';
    output.readOnly = true;
    output.placeholder = '这里会显示视频分析结果';
    output.style.cssText = [
    'width: 100%',
    'height: 120px',
    'box-sizing: border-box',
    'border: 1px solid #555',
    'border-radius: 6px',
    'padding: 8px',
    'resize: vertical',
    'background: #111',
    'color: #fff'
    ].join(';');

    const videoSizeInfo = create('div', { textContent: '视频大小: -' });
    videoSizeInfo.style.cssText = 'margin:8px 0 0;color:#a7d8ff;font-size:12px;line-height:1.5;text-align:center;';
    let activeAbortController = null;
    let lastVideoSizeText = '';

    function setVideoSizeInfo(sizeText) {
      const text = (sizeText || '').trim();
      videoSizeInfo.textContent = `视频大小: ${text || '-'}`;
    }

    function appendStatus(text) {
      const line = create('div', { textContent: text });
      line.style.cssText = 'padding:2px 0;border-bottom:1px dashed rgba(255,255,255,.15);';
      statusList.appendChild(line);
      statusList.scrollTop = statusList.scrollHeight;
    }

    function clearStatus() {
      clearNode(statusList);
    }

    function setLogsExpanded(expanded) {
      logSection.style.display = expanded ? 'block' : 'none';
      toggleLogsButton.textContent = expanded ? '收起日志' : '展开日志';
      if (!expanded) {
        statusList.style.height = '180px';
        return;
      }
      const adjust = () => {
        if (typeof panel.__adjustLogListHeight === 'function') {
          panel.__adjustLogListHeight();
        }
      };
      requestAnimationFrame(adjust);
    }

    panel.__adjustLogListHeight = () => {
      if (logSection.style.display === 'none') return;
      const panelRect = panel.getBoundingClientRect();
      const listRect = statusList.getBoundingClientRect();
      const bottomPadding = 12;
      const extraGap = 10;
      const footerReserve = Math.max(18, videoSizeInfo.offsetHeight || 0) + 8;
      const minHeight = 96;
      const maxHeight = 280;
      const available = Math.floor(panelRect.bottom - listRect.top - bottomPadding - extraGap - footerReserve);
      const nextHeight = Math.max(minHeight, Math.min(maxHeight, available));
      statusList.style.height = `${nextHeight}px`;
    };

    function extractAssistantText(payload) {
      if (!payload || typeof payload !== 'object') {
        return '';
      }

      const choice0 = payload?.choices?.[0];
      const messageContent = choice0?.message?.content;
      if (typeof messageContent === 'string' && messageContent.trim()) {
        return messageContent;
      }
      if (Array.isArray(messageContent)) {
        const parts = [];
        for (const part of messageContent) {
          if (typeof part === 'string' && part.trim()) {
            parts.push(part.trim());
          } else if (typeof part?.text === 'string' && part.text.trim()) {
            parts.push(part.text.trim());
          } else if (typeof part?.output_text === 'string' && part.output_text.trim()) {
            parts.push(part.output_text.trim());
          }
        }
        if (parts.length > 0) {
          return parts.join('\n');
        }
      }

      const choiceText = choice0?.text;
      if (typeof choiceText === 'string' && choiceText.trim()) {
        return choiceText;
      }

      if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text;
      }

      return '';
    }

    function createSSEState() {
      return {
        buffer: '',
        eventType: '',
        dataLines: []
      };
    }

    function parseSSELines(state, chunkText, isDone, outRef, onTextUpdate) {
      state.buffer += chunkText;
      const lines = state.buffer.split('\n');
      state.buffer = lines.pop() || '';
      if (isDone && state.buffer) {
        lines.push(state.buffer);
        state.buffer = '';
      }

      let reachedDone = false;
      let apiError = '';

      const handlePayload = (payload) => {
        if (!payload) return;

        if (state.eventType === 'log') {
          appendStatus(`[log] ${payload}`);
          try {
            const parsedLog = JSON.parse(payload);
            if (parsedLog?.event === 'video.download.finished') {
              const sizeText = parsedLog?.sizeMB || parsedLog?.size || '';
              const normalizedSize = String(sizeText || '').trim();
              if (normalizedSize && normalizedSize !== lastVideoSizeText) {
                appendStatus(`[video] 下载完成，大小: ${sizeText}`);
                setVideoSizeInfo(normalizedSize);
                lastVideoSizeText = normalizedSize;
              }
            }
            if (parsedLog?.event === 'video.download.completed') {
              const sizeText = parsedLog?.sizeMB || parsedLog?.size || '';
              const normalizedSize = String(sizeText || '').trim();
              if (normalizedSize && normalizedSize !== lastVideoSizeText) {
                appendStatus(`[video] 上传前文件大小: ${sizeText}`);
                setVideoSizeInfo(normalizedSize);
                lastVideoSizeText = normalizedSize;
              }
            }
          } catch {}
          return;
        }

        if (payload === '[DONE]') {
          reachedDone = true;
          appendStatus('收到 [DONE]');
          return;
        }

        appendStatus(`[data] ${payload}`);

        try {
          const parsed = JSON.parse(payload);
          if (parsed?.error) {
            apiError = String(parsed?.error?.message || '请求失败');
            appendStatus(`[error] ${apiError}`);
            return;
          }

          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            outRef.value += delta;
            if (typeof onTextUpdate === 'function') {
              onTextUpdate(outRef.value);
            }
          }
        } catch {
          // ignore malformed line
        }
      };

      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const normalized = line.trimStart();

        if (!normalized.trim()) {
          if (state.dataLines.length > 0) {
            handlePayload(state.dataLines.join('\n'));
            state.dataLines = [];
          }
          state.eventType = '';
          if (reachedDone || apiError) break;
          continue;
        }

        if (normalized.startsWith(':')) {
          continue;
        }

        const eventMatch = normalized.match(/^event\s*:(.*)$/);
        if (eventMatch) {
          state.eventType = eventMatch[1].trim();
          appendStatus(`[event] ${state.eventType || '(empty)'}`);
          continue;
        }

        const dataMatch = line.match(/^\s*data\s*:(.*)$/);
        if (dataMatch) {
          let dataLine = dataMatch[1];
          if (dataLine.startsWith(' ')) dataLine = dataLine.slice(1);
          state.dataLines.push(dataLine);
          continue;
        }

        appendStatus(`[line] ${line}`);
      }

      if ((isDone || reachedDone || apiError) && state.dataLines.length > 0) {
        handlePayload(state.dataLines.join('\n'));
        state.dataLines = [];
      }

      if (reachedDone || apiError) {
        state.eventType = '';
      }

      return { reachedDone, apiError };
    }

    input.addEventListener('input', () => {
      localStorage.setItem(STORAGE_KEY, input.value);
    });

    serverInput.addEventListener('input', () => {
      localStorage.setItem(SERVER_BASE_KEY, serverInput.value);
    });

    modelSelect.addEventListener('change', () => {
      localStorage.setItem(MODEL_KEY, modelSelect.value || DEFAULT_MODEL);
    });

    resolutionSelect.addEventListener('change', () => {
      localStorage.setItem(RESOLUTION_KEY, resolutionSelect.value || DEFAULT_RESOLUTION);
    });

    function setModelOptions(modelIds) {
      const deduped = Array.from(new Set((modelIds || []).filter(Boolean)));
      const current = localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
      const candidates = deduped.length > 0 ? deduped : [current];
      const selected = candidates.includes(current) ? current : candidates[0];

      clearNode(modelSelect);
      for (const modelId of candidates) {
        const option = create('option', { value: modelId, textContent: modelId });
        option.selected = modelId === selected;
        modelSelect.appendChild(option);
      }

      localStorage.setItem(MODEL_KEY, selected || DEFAULT_MODEL);
    }

    async function loadModels() {
      const serverBase = (serverInput.value || '').trim() || DEFAULT_SERVER_BASE;
      const normalizedBase = serverBase.replace(/\/+$/, '');
      const modelsUrl = `${normalizedBase}/v1/models`;

      reloadModelsButton.disabled = true;
      reloadModelsButton.textContent = '加载中...';
      appendStatus(`拉取模型列表: ${modelsUrl}`);

      try {
        const resp = await fetch(modelsUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });

        if (!resp.ok) {
          const errText = await resp.text();
          appendStatus(`模型列表请求失败: ${resp.status} ${errText || resp.statusText}`);
          return;
        }

        const payload = await resp.json();
        let modelIds = [];

        if (Array.isArray(payload?.data)) {
          modelIds = payload.data
            .map(item => (typeof item === 'string' ? item : item?.id))
            .filter(id => typeof id === 'string' && id.trim())
            .map(id => id.trim());
        } else if (Array.isArray(payload)) {
          modelIds = payload
            .map(item => (typeof item === 'string' ? item : item?.id))
            .filter(id => typeof id === 'string' && id.trim())
            .map(id => id.trim());
        }

        if (modelIds.length === 0) {
          appendStatus('模型列表为空，保留当前模型');
          return;
        }

        setModelOptions(modelIds);
        appendStatus(`模型加载完成，共 ${modelIds.length} 个`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        appendStatus(`加载模型异常: ${msg}`);
      } finally {
        reloadModelsButton.disabled = false;
        reloadModelsButton.textContent = '刷新模型';
      }
    }

    async function callVideoAnalysisApi() {
      const userText = input.value.trim();
      const serverBase = (serverInput.value || '').trim() || DEFAULT_SERVER_BASE;
      const normalizedBase = serverBase.replace(/\/+$/, '');
      const requestUrl = `${normalizedBase}/v1/chat/completions/log`;
      const selectedModel = modelSelect.value || localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
      const selectedResolution = resolutionSelect.value || localStorage.getItem(RESOLUTION_KEY) || DEFAULT_RESOLUTION;
      localStorage.setItem(STORAGE_KEY, userText);
      localStorage.setItem(SERVER_BASE_KEY, serverBase);
      localStorage.setItem(MODEL_KEY, selectedModel);
      localStorage.setItem(RESOLUTION_KEY, selectedResolution);

      clearStatus();
      output.value = '';
      setVideoSizeInfo('');
      lastVideoSizeText = '';

      appendStatus('准备请求 /v1/chat/completions/log ...');
      appendStatus(`输入内容: ${userText || '(空)'}`);
      appendStatus(`服务地址: ${normalizedBase}`);
      appendStatus(`模型: ${selectedModel}`);
      appendStatus(`下载清晰度(按高度): ${selectedResolution === 'default' ? '默认(按高度p)' : `${selectedResolution}p`}`);
      appendStatus(`视频链接: ${location.href}`);

      const controller = new AbortController();
      activeAbortController = controller;
      button.disabled = false;
      button.textContent = '中断请求';

      try {
        const response = await fetch(requestUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify({
            model: selectedModel,
            stream: true,
            messages: [
              {
                role: 'user',
                content: userText || DEFAULT_PROMPT
              }
            ],
            video_url: location.href,
            min_video_resolution: selectedResolution
          })
        });

        appendStatus(`HTTP ${response.status}`);

        if (!response.ok) {
          const errText = await response.text();
          appendStatus(`请求失败: ${errText || response.statusText}`);
          output.value = `请求失败: ${response.status} ${response.statusText}`;
          return;
        }

        if (!response.body) {
          const text = await response.text();
          appendStatus('响应不是流，按文本处理');
          appendStatus(text);
          try {
            const parsed = text ? JSON.parse(text) : null;
            output.value = (extractAssistantText(parsed) || text || '（空响应）').trim();
          } catch {
            output.value = text || '（空响应）';
          }
          return;
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const isEventStream = contentType.includes('text/event-stream');
        if (!isEventStream) {
          const text = await response.text();
          appendStatus('响应不是 SSE，按普通返回处理');
          appendStatus(text);
          try {
            const parsed = text ? JSON.parse(text) : null;
            output.value = (extractAssistantText(parsed) || text || '（空响应）').trim();
          } catch {
            output.value = text || '（空响应）';
          }
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        const sseState = createSSEState();
        const outRef = { value: '' };
        let gotDone = false;
        let streamError = '';
        let chunkIndex = 0;

        while (!gotDone) {
          const { done, value } = await reader.read();
          chunkIndex += 1;
          const chunkText = decoder.decode(value || new Uint8Array(), { stream: !done });
          if (chunkText) {
            appendStatus(`[chunk ${chunkIndex}] ${chunkText}`);
          }

          const parsed = parseSSELines(sseState, chunkText, done, outRef, (text) => {
            output.value = text;
          });
          if (parsed.apiError) {
            streamError = parsed.apiError;
            gotDone = true;
          }
          if (parsed.reachedDone || done) {
            gotDone = true;
          }
        }

        if (streamError) {
          output.value = `异常: ${streamError}`;
          appendStatus(`异常: ${streamError}`);
          return;
        }

        output.value = outRef.value || '（空响应）';
        appendStatus('流结束，已输出最终消息');
      } catch (error) {
        if (error && error.name === 'AbortError') {
          appendStatus('请求已手动中断');
          output.value = '请求已中断';
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        appendStatus(`异常: ${msg}`);
        output.value = `异常: ${msg}`;
      } finally {
        activeAbortController = null;
        button.disabled = false;
        button.textContent = '开始分析';
      }
    }

    button.addEventListener('click', () => {
      if (activeAbortController) {
        activeAbortController.abort();
        return;
      }
      callVideoAnalysisApi();
    });
    clearLogsButton.addEventListener('click', () => {
      clearStatus();
      appendStatus('日志已清空');
    });
    toggleLogsButton.addEventListener('click', () => {
      const expanded = logSection.style.display !== 'none';
      setLogsExpanded(!expanded);
    });
    reloadModelsButton.addEventListener('click', loadModels);

    panel.appendChild(title);
    panel.appendChild(input);
    panel.appendChild(serverInput);
    resolutionRow.appendChild(resolutionLabel);
    resolutionRow.appendChild(resolutionSelect);
    panel.appendChild(resolutionRow);
    modelRow.appendChild(modelSelect);
    modelRow.appendChild(reloadModelsButton);
    panel.appendChild(modelRow);
    panel.appendChild(button);
    panel.appendChild(outputTitle);
    panel.appendChild(output);
    panel.appendChild(toggleLogsButton);
    statusHeader.appendChild(statusTitle);
    statusHeader.appendChild(clearLogsButton);
    logSection.appendChild(statusHeader);
    logSection.appendChild(statusList);
    logSection.appendChild(videoSizeInfo);
    panel.appendChild(logSection);

    setTimeout(loadModels, 0);
    setLogsExpanded(false);

    return panel;
  }

  function buildLauncher() {
    const launcher = create('button', { id: LAUNCHER_ID });
    launcher.type = 'button';
    launcher.title = '视频分析';
    launcher.setAttribute('aria-label', '视频分析');
    launcher.style.cssText = [
      'position: fixed',
      'right: 16px',
      'top: 96px',
      'z-index: 1000000',
      'border: 0',
      'border-radius: 999px',
      'width: 44px',
      'height: 44px',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'padding: 0',
      'cursor: pointer',
      'background: #00a1d6',
      'color: #fff',
      'font-size: 0',
      'box-shadow: 0 8px 20px rgba(0,0,0,.35)'
    ].join(';');

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'rgba(255,255,255,0.35)');
    circle.setAttribute('stroke-width', '1.2');

    const playPath = document.createElementNS(SVG_NS, 'path');
    playPath.setAttribute('d', 'M9 7.8L16 12L9 16.2V7.8Z');
    playPath.setAttribute('fill', '#FFFFFF');

    const waveTop = document.createElementNS(SVG_NS, 'path');
    waveTop.setAttribute('d', 'M18.2 7.2C19.5 8.5 20.3 10.2 20.3 12');
    waveTop.setAttribute('fill', 'none');
    waveTop.setAttribute('stroke', '#FFFFFF');
    waveTop.setAttribute('stroke-width', '1.5');
    waveTop.setAttribute('stroke-linecap', 'round');

    const waveBottom = document.createElementNS(SVG_NS, 'path');
    waveBottom.setAttribute('d', 'M18.2 16.8C19.5 15.5 20.3 13.8 20.3 12');
    waveBottom.setAttribute('fill', 'none');
    waveBottom.setAttribute('stroke', '#FFFFFF');
    waveBottom.setAttribute('stroke-width', '1.5');
    waveBottom.setAttribute('stroke-linecap', 'round');

    svg.appendChild(circle);
    svg.appendChild(playPath);
    svg.appendChild(waveTop);
    svg.appendChild(waveBottom);
    launcher.appendChild(svg);

    return launcher;
  }

  function getLauncherPosition() {
    const raw = localStorage.getItem(LAUNCHER_POS_KEY);
    if (!raw) {
      return { right: 16, top: 96 };
    }
    try {
      const parsed = JSON.parse(raw);
      const right = Number(parsed?.right);
      const top = Number(parsed?.top);
      if (!Number.isFinite(right) || !Number.isFinite(top)) {
        return { right: 16, top: 96 };
      }
      return {
        right: Math.max(0, right),
        top: Math.max(0, top),
      };
    } catch {
      return { right: 16, top: 96 };
    }
  }

  function syncPanelToLauncher(launcher, panel) {
    if (!launcher || !panel) {
      return;
    }

    const gap = 10;
    const margin = 8;
    const launcherRect = launcher.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || 360;
    const panelHeight = panelRect.height || 300;

    const leftPreferred = launcherRect.left - panelWidth - gap;
    const rightCandidate = launcherRect.right + gap;

    let left = leftPreferred;
    if (left < margin) {
      if (rightCandidate + panelWidth <= window.innerWidth - margin) {
        left = rightCandidate;
      } else {
        left = Math.max(margin, window.innerWidth - panelWidth - margin);
      }
    }

    let top = launcherRect.top;
    const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
    top = Math.min(Math.max(margin, top), maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    if (typeof panel.__adjustLogListHeight === 'function') {
      panel.__adjustLogListHeight();
    }
  }

  function setLauncherPosition(launcher, right, top, panel) {
    const maxRight = Math.max(0, window.innerWidth - launcher.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - launcher.offsetHeight);
    const safeRight = Math.min(Math.max(0, right), maxRight);
    const safeTop = Math.min(Math.max(0, top), maxTop);
    launcher.style.right = `${safeRight}px`;
    launcher.style.top = `${safeTop}px`;
    localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify({ right: safeRight, top: safeTop }));

    if (panel && panel.style.display !== 'none') {
      syncPanelToLauncher(launcher, panel);
    }
  }

  function installLauncherDrag(launcher, panel) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startRight = 16;
    let startTop = 96;

    const onMove = (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        moved = true;
      }
      setLauncherPosition(launcher, startRight - dx, startTop + dy, panel);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      launcher.dataset.dragMoved = moved ? '1' : '0';
    };

    launcher.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      dragging = true;
      moved = false;
      const right = parseFloat(launcher.style.right);
      const top = parseFloat(launcher.style.top);
      startRight = Number.isFinite(right) ? right : 16;
      startTop = Number.isFinite(top) ? top : 96;
      startX = event.clientX;
      startY = event.clientY;
      launcher.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    });
  }

  function setExpanded(expanded) {
    const panel = document.getElementById(PANEL_ID);
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!panel || !launcher) {
      return;
    }

    panel.style.display = expanded ? 'block' : 'none';
    if (expanded) {
      syncPanelToLauncher(launcher, panel);
    }
    launcher.title = expanded ? '收起视频分析' : '展开视频分析';
    launcher.setAttribute('aria-label', expanded ? '收起视频分析' : '展开视频分析');
  }

  function mountPanel() {
    if (!isSupportedPage()) {
      const panel = document.getElementById(PANEL_ID);
      const launcher = document.getElementById(LAUNCHER_ID);
      if (panel) panel.remove();
      if (launcher) launcher.remove();
      return;
    }

    if (!document.body) {
      return;
    }

    ensureScrollbarStyles();

    if (document.getElementById(PANEL_ID) && document.getElementById(LAUNCHER_ID)) {
      return;
    }

    const existPanel = document.getElementById(PANEL_ID);
    const existLauncher = document.getElementById(LAUNCHER_ID);
    if (existPanel) {
      existPanel.remove();
    }
    if (existLauncher) {
      existLauncher.remove();
    }

    const launcher = buildLauncher();
    const panel = buildPanel();
    const pos = getLauncherPosition();
    setLauncherPosition(launcher, pos.right, pos.top, panel);
    installLauncherDrag(launcher, panel);

    launcher.addEventListener('click', () => {
      if (launcher.dataset.dragMoved === '1') {
        launcher.dataset.dragMoved = '0';
        return;
      }
      const expanded = panel.style.display !== 'none';
      setExpanded(!expanded);
    });

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    setExpanded(false);

    if (!resizeHookInstalled) {
      window.addEventListener('resize', () => {
        const currentLauncher = document.getElementById(LAUNCHER_ID);
        const currentPanel = document.getElementById(PANEL_ID);
        if (!currentLauncher || !currentPanel) {
          return;
        }

        const right = parseFloat(currentLauncher.style.right);
        const top = parseFloat(currentLauncher.style.top);
        setLauncherPosition(
          currentLauncher,
          Number.isFinite(right) ? right : 16,
          Number.isFinite(top) ? top : 96,
          currentPanel
        );
      }, true);
      resizeHookInstalled = true;
    }

    lastInitUrl = location.href;
  }

  function installRouteHooks() {
    if (routeObserver) {
      return;
    }

    let mountTimeout = null;

    const trigger = () => {
      if (location.href !== lastInitUrl) {
        if (mountTimeout) {
          clearTimeout(mountTimeout);
        }
        mountTimeout = setTimeout(mountPanel, 100);
      }
    };

    const rawPushState = history.pushState;
    history.pushState = function (...args) {
      const result = rawPushState.apply(this, args);
      trigger();
      return result;
    };

    const rawReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = rawReplaceState.apply(this, args);
      trigger();
      return result;
    };

    window.addEventListener('popstate', trigger, true);

    let mutationTimeout = null;
    routeObserver = new MutationObserver(() => {
      if ((!document.getElementById(PANEL_ID) || !document.getElementById(LAUNCHER_ID)) && isSupportedPage()) {
        if (mutationTimeout) {
          clearTimeout(mutationTimeout);
        }
        mutationTimeout = setTimeout(mountPanel, 200);
      }
    });

    if (document.documentElement) {
      routeObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function bootstrap() {
    if (bootstrapped) {
      return;
    }
    bootstrapped = true;
    mountPanel();
    installRouteHooks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

})();
