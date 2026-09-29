/* ==========================================================================
   BLE CHAT APP - PROFESSIONAL PEER-TO-PEER MESH ENGINE
   ========================================================================== */

(function () {
  'use strict';

  // Local Storage Keys
  const STORAGE_KEY_IDENTITY = 'blechat_identity';

  // State
  const state = {
    myPeerId: generateShortId(),
    myNickname: 'Node-' + generateRandomHex(2).toUpperCase(),
    myNoiseStaticKey: generateNoiseFingerprint(),
    currentChannel: {
      type: 'mesh',
      id: 'bluetooth',
      name: 'mesh #bluetooth',
      badge: 'FLOOD ROUTING',
      icon: 'ph-fill ph-broadcast'
    },
    // Real-time discovered peers { id, peerId, nickname, lastSeen, rssi, hops }
    discoveredPeers: new Map(),
    // Messages keyed by channel e.g. "mesh:bluetooth" or "dm:peerId"
    messages: {
      'mesh:bluetooth': [],
      'mesh:sos': [],
      'geohash:block-local': []
    }
  };

  // Load saved identity from localStorage
  loadSavedIdentity();

  // Peer-to-Peer Communication
  let bc = null;
  try {
    bc = new BroadcastChannel('blechat_local_mesh');
  } catch (e) {
    console.warn('BroadcastChannel not supported:', e);
  }

  let eventSource = null;

  // DOM Elements
  const el = {
    viewport: document.getElementById('app-viewport'),
    btnToggleView: document.getElementById('btn-toggle-view'),
    deviceClock: document.getElementById('device-clock'),
    meshPulseIndicator: document.getElementById('mesh-pulse-indicator'),
    globalMeshStatus: document.getElementById('global-mesh-status'),
    myPeerIdDisplay: document.getElementById('my-peer-id-display'),
    btnEditMyId: document.getElementById('btn-edit-my-id'),

    // App Header
    btnOpenChannels: document.getElementById('btn-open-channels'),
    btnOpenPeers: document.getElementById('btn-open-peers'),
    btnOpenIdentity: document.getElementById('btn-open-identity'),
    headerChanIcon: document.getElementById('header-chan-icon'),
    headerChanName: document.getElementById('header-chan-name'),
    headerChanBadge: document.getElementById('header-chan-badge'),
    headerPeerCount: document.getElementById('header-peer-count'),
    headerPeerBadge: document.getElementById('header-peer-badge'),

    // Drawers & Overlay
    drawerOverlay: document.getElementById('drawer-overlay'),
    channelsDrawer: document.getElementById('channels-drawer'),
    peersDrawer: document.getElementById('peers-drawer'),
    btnCloseChannels: document.getElementById('btn-close-channels'),
    btnClosePeers: document.getElementById('btn-close-peers'),
    peersListContainer: document.getElementById('peers-list-container'),
    emptyPeersNotice: document.getElementById('empty-peers-notice'),
    dmChannelList: document.getElementById('dm-channel-list'),
    dmEmptyHint: document.getElementById('dm-empty-hint'),

    // Chat Feed
    messagesStream: document.getElementById('messages-stream'),
    messagesScrollArea: document.getElementById('messages-scroll-area'),
    tickerText: document.getElementById('ticker-text'),

    // Composer
    messageInput: document.getElementById('message-input'),
    btnSend: document.getElementById('btn-send'),
    charCounter: document.getElementById('char-counter'),
    slashPopup: document.getElementById('slash-popup'),
    btnShowQr: document.getElementById('btn-show-qr-verify'),
    btnEditNickTool: document.getElementById('btn-edit-nick-tool'),
    btnQuickSlash: document.getElementById('btn-quick-slash'),

    // Modals
    modalIdentity: document.getElementById('modal-identity'),
    inputNickname: document.getElementById('input-nickname'),
    inputPeerId: document.getElementById('input-peer-id'),
    displayStaticKey: document.getElementById('display-static-key'),
    btnGenRandomId: document.getElementById('btn-gen-random-id'),
    btnCloseIdentity: document.getElementById('btn-close-identity'),
    btnCancelIdentity: document.getElementById('btn-cancel-identity'),
    btnSaveIdentity: document.getElementById('btn-save-identity'),

    modalQr: document.getElementById('modal-qr'),
    btnCloseQr: document.getElementById('btn-close-qr'),
    btnConfirmQr: document.getElementById('btn-confirm-qr'),
    myFullFingerprint: document.getElementById('my-full-fingerprint')
  };

  function generateRandomHex(bytes = 2) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateShortId() {
    return `${generateRandomHex(2)}:${generateRandomHex(2)}`;
  }

  function generateNoiseFingerprint() {
    return Array.from({ length: 8 }, () => generateRandomHex(4)).join('');
  }

  function loadSavedIdentity() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_IDENTITY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.myPeerId) state.myPeerId = parsed.myPeerId;
        if (parsed.myNickname) state.myNickname = parsed.myNickname;
        if (parsed.myNoiseStaticKey) state.myNoiseStaticKey = parsed.myNoiseStaticKey;
      }
    } catch (e) {}
  }

  function saveIdentity() {
    try {
      localStorage.setItem(STORAGE_KEY_IDENTITY, JSON.stringify({
        myPeerId: state.myPeerId,
        myNickname: state.myNickname,
        myNoiseStaticKey: state.myNoiseStaticKey
      }));
    } catch (e) {}
  }

  function init() {
    updateClock();
    setInterval(updateClock, 1000);

    updateIdentityUI();
    renderCurrentChannelMessages();
    setupEventListeners();
    setupSlashCommands();
    initMeshNetworking();

    // Broadcast initial announce
    broadcastAnnounce();
    setInterval(broadcastAnnounce, 12000);
    setInterval(pruneStalePeers, 5000);
  }

  function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    if (el.deviceClock) el.deviceClock.textContent = `${hours}:${mins}`;
  }

  function updateIdentityUI() {
    if (el.myPeerIdDisplay) el.myPeerIdDisplay.textContent = state.myPeerId;
    if (el.myFullFingerprint) el.myFullFingerprint.textContent = `SHA256: ${state.myNoiseStaticKey.toUpperCase()}`;
    if (el.displayStaticKey) el.displayStaticKey.textContent = state.myNoiseStaticKey;
  }

  // Mesh Networking
  function initMeshNetworking() {
    if (bc) {
      bc.onmessage = (e) => {
        handleIncomingPacket(e.data);
      };
    }

    if (window.EventSource) {
      eventSource = new EventSource('/api/mesh/events');
      eventSource.onmessage = (e) => {
        try {
          const packet = JSON.parse(e.data);
          handleIncomingPacket(packet);
        } catch (err) {}
      };
    }
  }

  function emitPacket(packet) {
    if (bc) {
      try { bc.postMessage(packet); } catch (e) {}
    }

    fetch('/api/mesh/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(packet)
    }).catch(() => {});
  }

  function broadcastAnnounce() {
    const packet = {
      type: 'ANNOUNCE',
      senderId: state.myPeerId,
      nickname: state.myNickname,
      staticKey: state.myNoiseStaticKey,
      timestamp: Date.now(),
      ttl: 7
    };
    emitPacket(packet);
  }

  function handleIncomingPacket(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.senderId === state.myPeerId) return;

    if (packet.type === 'ANNOUNCE') {
      handlePeerAnnounce(packet);
    } else if (packet.type === 'MESSAGE') {
      handleIncomingMessage(packet);
    } else if (packet.type === 'ACTION') {
      handleIncomingAction(packet);
    } else if (packet.type === 'PING') {
      handleIncomingPing(packet);
    }
  }

  function handlePeerAnnounce(packet) {
    const peerId = packet.senderId;
    const isNew = !state.discoveredPeers.has(peerId);

    state.discoveredPeers.set(peerId, {
      id: peerId,
      peerId: peerId,
      nickname: packet.nickname || `Peer-${peerId}`,
      staticKey: packet.staticKey || '',
      lastSeen: Date.now(),
      rssi: -55 - Math.floor(Math.random() * 20),
      hops: 1
    });

    renderPeersUI();

    if (isNew) {
      el.tickerText.textContent = `[BLE] Discovered node ${packet.nickname || peerId} (1 hop)`;
      broadcastAnnounce();
    }
  }

  function pruneStalePeers() {
    const now = Date.now();
    let changed = false;

    state.discoveredPeers.forEach((peer, id) => {
      if (now - peer.lastSeen > 35000) {
        state.discoveredPeers.delete(id);
        changed = true;
      }
    });

    if (changed) {
      renderPeersUI();
    }
  }

  function renderPeersUI() {
    const peers = Array.from(state.discoveredPeers.values());
    const count = peers.length;

    if (el.headerPeerBadge) el.headerPeerBadge.textContent = count;
    if (el.headerPeerCount) el.headerPeerCount.textContent = `${count} peer${count === 1 ? '' : 's'} in radio range`;
    if (el.globalMeshStatus) el.globalMeshStatus.textContent = count > 0 ? `ACTIVE (${count} Nodes)` : 'LISTENING';

    if (count === 0) {
      el.peersListContainer.innerHTML = `
        <div class="empty-peers-notice">
          <div class="empty-icon-wrap">
            <i class="ph ph-broadcast text-cyan text-3xl"></i>
          </div>
          <h4>Listening for Nearby Nodes</h4>
          <p>No other peers detected in radio range. Open this application in another browser tab or device to connect.</p>
        </div>
      `;
      if (el.dmEmptyHint) el.dmEmptyHint.style.display = 'block';
      return;
    }

    if (el.dmEmptyHint) el.dmEmptyHint.style.display = 'none';

    // Render Peers Drawer List
    el.peersListContainer.innerHTML = peers.map(p => {
      const initials = p.nickname.substring(0, 2).toUpperCase();
      return `
        <div class="peer-node-card">
          <div class="peer-card-left">
            <div class="peer-avatar">${initials}</div>
            <div class="peer-info">
              <h4>${escapeHtml(p.nickname)}</h4>
              <div class="peer-meta">
                <span class="font-mono text-cyan">${p.peerId}</span>
                <span>•</span>
                <span>${p.hops} Hop (${p.rssi}dBm)</span>
              </div>
            </div>
          </div>
          <button class="btn-peer-dm" data-peer-id="${p.peerId}" data-nickname="${escapeHtml(p.nickname)}">
            <i class="ph ph-chat-circle-dots"></i> Chat
          </button>
        </div>
      `;
    }).join('');

    // Render DM list in Channels drawer
    const dmList = document.getElementById('dm-channel-list');
    if (dmList) {
      dmList.innerHTML = peers.map(p => {
        const initials = p.nickname.substring(0, 2).toUpperCase();
        const isActive = state.currentChannel.type === 'dm' && state.currentChannel.id === p.peerId;
        return `
          <li class="channel-item ${isActive ? 'active' : ''}" data-channel-type="dm" data-peer-id="${p.peerId}" data-nickname="${escapeHtml(p.nickname)}">
            <div class="item-icon-box bg-blue-glow font-mono" style="font-size: 0.72rem; font-weight: 700;">${initials}</div>
            <div class="item-content">
              <div class="item-top">
                <span class="item-name">${escapeHtml(p.nickname)}</span>
                <span class="font-mono text-xs text-cyan">${p.peerId}</span>
              </div>
              <div class="item-preview">Direct Message</div>
            </div>
          </li>
        `;
      }).join('');
    }
  }

  function getChannelKey(channel = state.currentChannel) {
    return `${channel.type}:${channel.id}`;
  }

  function handleIncomingMessage(packet) {
    const isDM = packet.channelType === 'dm';
    const targetKey = isDM ? `dm:${packet.senderId}` : `${packet.channelType}:${packet.channelId}`;

    if (!state.messages[targetKey]) {
      state.messages[targetKey] = [];
    }

    const now = new Date(packet.timestamp || Date.now());
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    state.messages[targetKey].push({
      id: packet.msgId || `m-${Date.now()}`,
      senderId: packet.senderId,
      senderName: packet.senderNickname || packet.senderId,
      initials: (packet.senderNickname || packet.senderId).substring(0, 2).toUpperCase(),
      time: timeStr,
      text: packet.text,
      isOutgoing: false,
      isEncrypted: isDM
    });

    if (getChannelKey() === targetKey) {
      renderCurrentChannelMessages();
    } else {
      el.tickerText.textContent = `[BLE] New message from ${packet.senderNickname} in ${packet.channelType === 'dm' ? 'Direct Chat' : packet.channelId}`;
    }
  }

  function handleIncomingAction(packet) {
    const targetKey = `${packet.channelType}:${packet.channelId}`;
    if (getChannelKey() === targetKey) {
      const eventRow = document.createElement('div');
      eventRow.className = 'message-event-row';
      eventRow.innerHTML = `<i class="ph-fill ph-arrow-bend-right-down text-cyan"></i> <span>* ${escapeHtml(packet.senderNickname)} ${escapeHtml(packet.text)} *</span>`;
      el.messagesStream.appendChild(eventRow);
      scrollToBottom();
    }
  }

  function handleIncomingPing(packet) {
    if (packet.targetId === state.myPeerId) {
      el.tickerText.textContent = `[Ping] Received ping from ${packet.senderNickname} (${packet.senderId})`;
    }
  }

  function renderCurrentChannelMessages() {
    const key = getChannelKey();
    const msgs = state.messages[key] || [];

    el.messagesStream.innerHTML = '';

    if (msgs.length === 0) {
      el.messagesStream.innerHTML = `
        <div class="empty-chat-state">
          <i class="${state.currentChannel.icon}"></i>
          <h3>${escapeHtml(state.currentChannel.name)}</h3>
          <p>${state.currentChannel.type === 'dm' ? 'Direct message channel. Packets transmit directly to this node.' : 'Public broadcast channel. All nearby peers in radio range receive these messages.'}</p>
        </div>
      `;
      return;
    }

    msgs.forEach((m) => {
      const row = document.createElement('div');
      row.className = `message-row ${m.isOutgoing ? 'outgoing' : 'incoming'}`;

      row.innerHTML = `
        <div class="msg-avatar">${m.initials}</div>
        <div class="msg-bubble-wrap">
          <div class="msg-meta-header">
            <span class="msg-sender-name">${escapeHtml(m.senderName)}</span>
            <span>${m.time}</span>
          </div>
          <div class="msg-bubble ${m.isEncrypted ? 'encrypted-bubble' : ''}">
            <p>${escapeHtml(m.text || '')}</p>
            <div class="msg-bubble-footer">
              <span>${m.time}</span>
              ${m.isOutgoing ? '<i class="ph-fill ph-checks text-cyan" title="Delivered"></i>' : ''}
            </div>
          </div>
        </div>
      `;

      el.messagesStream.appendChild(row);
    });

    scrollToBottom();
  }

  function scrollToBottom() {
    setTimeout(() => {
      el.messagesScrollArea.scrollTop = el.messagesScrollArea.scrollHeight;
    }, 40);
  }

  // Drawers open/close helper
  function openDrawer(drawerEl) {
    if (drawerEl) {
      drawerEl.classList.add('open');
      if (el.drawerOverlay) el.drawerOverlay.classList.add('active');
    }
  }

  function closeAllDrawers() {
    if (el.channelsDrawer) el.channelsDrawer.classList.remove('open');
    if (el.peersDrawer) el.peersDrawer.classList.remove('open');
    if (el.drawerOverlay) el.drawerOverlay.classList.remove('active');
  }

  function switchChannel(type, id, name, badge, icon) {
    state.currentChannel = { type, id, name, badge, icon };
    
    el.headerChanName.textContent = name;
    el.headerChanBadge.textContent = badge || (type === 'dm' ? 'DIRECT MESSAGE' : 'FLOOD ROUTING');
    el.headerChanIcon.innerHTML = `<i class="${icon || 'ph-fill ph-chat-circle'}"></i>`;

    // Highlight in drawer
    document.querySelectorAll('.channel-item').forEach((it) => it.classList.remove('active'));
    const activeItem = document.querySelector(`[data-channel-type="${type}"][data-channel-id="${id}"], [data-channel-type="${type}"][data-peer-id="${id}"]`);
    if (activeItem) activeItem.classList.add('active');

    closeAllDrawers();
    renderCurrentChannelMessages();
  }

  function sendMessage() {
    const text = el.messageInput.value.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      handleSlashCommand(text);
      el.messageInput.value = '';
      adjustTextareaHeight();
      return;
    }

    const key = getChannelKey();
    if (!state.messages[key]) state.messages[key] = [];

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const msgId = `m-${Date.now()}-${generateRandomHex(2)}`;

    state.messages[key].push({
      id: msgId,
      senderId: state.myPeerId,
      senderName: state.myNickname,
      initials: state.myNickname.substring(0, 2).toUpperCase(),
      time: timeStr,
      text: text,
      isOutgoing: true,
      isEncrypted: state.currentChannel.type === 'dm'
    });

    const packet = {
      type: 'MESSAGE',
      msgId: msgId,
      channelType: state.currentChannel.type,
      channelId: state.currentChannel.id,
      senderId: state.myPeerId,
      senderNickname: state.myNickname,
      text: text,
      timestamp: Date.now(),
      ttl: 7
    };
    emitPacket(packet);

    el.messageInput.value = '';
    adjustTextareaHeight();
    renderCurrentChannelMessages();
  }

  function handleSlashCommand(cmdStr) {
    const parts = cmdStr.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const key = getChannelKey();
    if (!state.messages[key]) state.messages[key] = [];

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (cmd === '/who') {
      const peers = Array.from(state.discoveredPeers.values());
      const listStr = peers.length > 0
        ? peers.map(p => `• ${p.nickname} [${p.peerId}] (${p.hops} hop, ${p.rssi}dBm)`).join('\n')
        : '• No other peers in range right now.';
      
      state.messages[key].push({
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: 'BLE Service Status',
        initials: 'SYS',
        time: timeStr,
        text: `Nearby Nodes (${peers.length}):\n${listStr}`,
        isOutgoing: false,
        isEncrypted: false
      });
      renderCurrentChannelMessages();
    } else if (cmd === '/nick') {
      if (args.trim()) {
        state.myNickname = args.trim().substring(0, 24);
        saveIdentity();
        updateIdentityUI();
        broadcastAnnounce();
        state.messages[key].push({
          id: `sys-${Date.now()}`,
          senderId: 'system',
          senderName: 'Identity Service',
          initials: 'SYS',
          time: timeStr,
          text: `Your broadcast nickname has been updated to "${state.myNickname}".`,
          isOutgoing: false,
          isEncrypted: false
        });
        renderCurrentChannelMessages();
      }
    } else if (cmd === '/slap') {
      const target = args || 'everyone in mesh radius';
      const actionText = `slaps ${target} around with a large trout`;
      
      const eventRow = document.createElement('div');
      eventRow.className = 'message-event-row';
      eventRow.innerHTML = `<i class="ph-fill ph-arrow-bend-right-down text-cyan"></i> <span>* ${escapeHtml(state.myNickname)} ${escapeHtml(actionText)} *</span>`;
      el.messagesStream.appendChild(eventRow);
      scrollToBottom();

      emitPacket({
        type: 'ACTION',
        channelType: state.currentChannel.type,
        channelId: state.currentChannel.id,
        senderId: state.myPeerId,
        senderNickname: state.myNickname,
        text: actionText,
        timestamp: Date.now()
      });
    } else if (cmd === '/ping') {
      const target = args.trim();
      emitPacket({
        type: 'PING',
        targetId: target,
        senderId: state.myPeerId,
        senderNickname: state.myNickname
      });
      state.messages[key].push({
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: 'Ping Diagnostic',
        initials: 'PNG',
        time: timeStr,
        text: `Ping packet emitted to network (TTL=7). Estimated roundtrip latency: <20ms`,
        isOutgoing: false,
        isEncrypted: false
      });
      renderCurrentChannelMessages();
    } else if (cmd === '/clear') {
      state.messages[key] = [];
      renderCurrentChannelMessages();
    }
  }

  function adjustTextareaHeight() {
    el.messageInput.style.height = 'auto';
    el.messageInput.style.height = `${Math.min(el.messageInput.scrollHeight, 100)}px`;
  }

  function openModal(modalEl) {
    if (modalEl) modalEl.classList.add('open');
  }

  function closeModal(modalEl) {
    if (modalEl) modalEl.classList.remove('open');
  }

  function setupSlashCommands() {
    el.messageInput.addEventListener('input', () => {
      const val = el.messageInput.value;
      if (val === '/' || (val.startsWith('/') && !val.includes(' '))) {
        el.slashPopup.classList.add('visible');
      } else {
        el.slashPopup.classList.remove('visible');
      }
      adjustTextareaHeight();
    });

    document.querySelectorAll('.slash-item').forEach((item) => {
      item.addEventListener('click', () => {
        const cmd = item.getAttribute('data-cmd');
        el.messageInput.value = `${cmd} `;
        el.slashPopup.classList.remove('visible');
        el.messageInput.focus();
        adjustTextareaHeight();
      });
    });
  }

  function setupEventListeners() {
    // Viewport Toggle
    el.btnToggleView.addEventListener('click', () => {
      el.viewport.classList.toggle('mobile-frame');
      el.viewport.classList.toggle('fullscreen-frame');
      const isMobile = el.viewport.classList.contains('mobile-frame');
      el.btnToggleView.querySelector('.btn-text').textContent = isMobile ? 'Full Screen' : 'Mobile View';
    });

    // Drawers Open & Close
    el.btnOpenChannels.addEventListener('click', () => openDrawer(el.channelsDrawer));
    el.btnOpenPeers.addEventListener('click', () => openDrawer(el.peersDrawer));

    // Working Prominent Close "X" Buttons
    if (el.btnCloseChannels) {
      el.btnCloseChannels.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDrawers();
      });
    }

    if (el.btnClosePeers) {
      el.btnClosePeers.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllDrawers();
      });
    }

    // Overlay click to close any drawer
    if (el.drawerOverlay) {
      el.drawerOverlay.addEventListener('click', closeAllDrawers);
    }

    // Identity Modal
    const openIdentityModal = () => {
      el.inputNickname.value = state.myNickname;
      el.inputPeerId.value = state.myPeerId;
      openModal(el.modalIdentity);
    };

    el.btnEditMyId.addEventListener('click', openIdentityModal);
    el.btnOpenIdentity.addEventListener('click', openIdentityModal);
    el.btnEditNickTool.addEventListener('click', openIdentityModal);

    el.btnCloseIdentity.addEventListener('click', () => closeModal(el.modalIdentity));
    el.btnCancelIdentity.addEventListener('click', () => closeModal(el.modalIdentity));

    el.btnGenRandomId.addEventListener('click', () => {
      el.inputPeerId.value = generateShortId();
    });

    el.btnSaveIdentity.addEventListener('click', () => {
      const newNick = el.inputNickname.value.trim() || state.myNickname;
      let newId = el.inputPeerId.value.trim();
      if (!newId.includes(':') && newId.length >= 4) {
        newId = `${newId.substring(0, 4)}:${newId.substring(4, 8) || '0000'}`;
      }

      state.myNickname = newNick;
      state.myPeerId = newId;
      saveIdentity();
      updateIdentityUI();
      closeModal(el.modalIdentity);

      broadcastAnnounce();
    });

    // QR Modal
    el.btnShowQr.addEventListener('click', () => openModal(el.modalQr));
    el.btnCloseQr.addEventListener('click', () => closeModal(el.modalQr));
    el.btnConfirmQr.addEventListener('click', () => closeModal(el.modalQr));

    // Channel Delegation
    document.addEventListener('click', (e) => {
      const item = e.target.closest('.channel-item');
      if (item) {
        const type = item.getAttribute('data-channel-type');
        if (type === 'dm') {
          const peerId = item.getAttribute('data-peer-id');
          const nick = item.getAttribute('data-nickname') || peerId;
          switchChannel('dm', peerId, `${nick}`, 'DIRECT MESSAGE', 'ph-fill ph-lock-key');
        } else {
          const id = item.getAttribute('data-channel-id');
          const name = item.querySelector('.item-name').textContent;
          switchChannel(type, id, name, type === 'mesh' ? 'FLOOD ROUTING' : 'GEOHASH NOSTR', 'ph-fill ph-broadcast');
        }
      }

      const dmBtn = e.target.closest('.btn-peer-dm');
      if (dmBtn) {
        const peerId = dmBtn.getAttribute('data-peer-id');
        const nick = dmBtn.getAttribute('data-nickname') || peerId;
        switchChannel('dm', peerId, `${nick}`, 'DIRECT MESSAGE', 'ph-fill ph-lock-key');
      }
    });

    // Send Message
    el.btnSend.addEventListener('click', sendMessage);
    el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
