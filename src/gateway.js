const { WebSocket } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const debug = require('./debug');
const { DEFAULT_MODEL, SYSTEM_PROMPT } = require('./constants');

const log = debug.createLogger('gateway');

/**
 * Load device identity for OpenClaw Gateway authentication.
 * Falls back to shared-secret token if device auth is not available.
 */
function loadDeviceAuth() {
  const identityDir = path.join(os.homedir(), '.openclaw', 'identity');

  try {
    const devicePath = path.join(identityDir, 'device.json');
    const deviceAuthPath = path.join(identityDir, 'device-auth.json');

    if (fs.existsSync(devicePath) && fs.existsSync(deviceAuthPath)) {
      const device = JSON.parse(fs.readFileSync(devicePath, 'utf-8'));
      const deviceAuth = JSON.parse(fs.readFileSync(deviceAuthPath, 'utf-8'));

      const tokenEntry = deviceAuth.tokens?.operator;
      if (tokenEntry?.token) {
        log('Loaded device auth (id: %s...)', device.deviceId?.slice(0, 8));
        return {
          deviceId: device.deviceId,
          publicKeyPem: device.publicKeyPem,
          privateKeyPem: device.privateKeyPem,
          deviceToken: tokenEntry.token,
          scopes: tokenEntry.scopes || [],
          platform: os.platform(),
        };
      }
    }
  } catch (err) {
    log.warn('Failed to load device auth: %s', err.message);
  }
  return null;
}

/**
 * Build the device payload for signing (v2 format, pipe-separated).
 */
function buildDevicePayload(nonce, deviceId, role, scopes, signedAtMs, deviceToken) {
  return [
    'v2',
    deviceId,
    'cli',
    'cli',
    role,
    scopes.sort().join(','),
    String(signedAtMs),
    deviceToken || '',
    nonce,
  ].join('|');
}

/**
 * Sign payload with Ed25519 private key.
 */
function signPayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(payload), key);
  return signature.toString('base64url');
}

/**
 * Extract base64 public key from PEM for fingerprint.
 */
function publicKeyRawBase64FromPem(pem) {
  const key = crypto.createPublicKey(pem);
  const der = key.export({ format: 'der', type: 'spki' });
  // Ed25519 SPKI: 12-byte header + 32-byte key
  return der.slice(12).toString('base64url');
}

/**
 * OpenClaw Gateway WebSocket client with proper protocol handshake.
 *
 * Protocol:
 * 1. Connect to ws://<gateway>/ws
 * 2. Receive connect.challenge event
 * 3. Send connect RPC request with device token + signed nonce
 * 4. Receive hello-ok response
 * 5. Use agent RPC method to send messages
 */
function createConnection(config) {
  const baseUrl = config.gateway.url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';
  const wsUrl = config.gateway.wsUrl || baseUrl;
  const token = config.gateway.token;
  const deviceAuth = loadDeviceAuth();

  log('Connecting to %s (device auth: %s)', wsUrl, deviceAuth ? 'yes' : 'no');

  const wsHeaders = {};
  if (token) {
    wsHeaders['Authorization'] = `Bearer ${token}`;
  }

  const tlsOptions = {};
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    tlsOptions.rejectUnauthorized = false;
  }

  const ws = new WebSocket(wsUrl, { headers: wsHeaders, ...tlsOptions });

  let pendingRequests = new Map();
  let reqId = 0;
  let connected = false;
  let connectResolve = null;
  let connectReject = null;
  let messageHandler = null;

  // Handle incoming messages
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      log('Received binary message (%d bytes)', data.length);
      return;
    }

    const text = data.toString();
    log('Raw message: %s', text.slice(0, 300));

    try {
      const msg = JSON.parse(text);

      if (msg.type === 'event') {
        // connect.challenge — respond with connect RPC
        if (msg.event === 'connect.challenge') {
          const nonce = msg.payload?.nonce;
          if (!nonce) {
            log.error('connect.challenge missing nonce');
            ws.close(1008, 'connect challenge missing nonce');
            return;
          }
          log('Got challenge nonce');

          const id = ++reqId + '-' + Date.now();
          const params = {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'cli',
              version: '0.1.0',
              platform: os.platform(),
              mode: 'cli',
            },
            role: 'operator',
            scopes: deviceAuth ? deviceAuth.scopes : ['operator.read', 'operator.write'],
            caps: [],
          };

          // Use device auth if available
          if (deviceAuth) {
            const publicKeyRaw = publicKeyRawBase64FromPem(deviceAuth.publicKeyPem);
            const signedAtMs = Date.now();
            const payload = buildDevicePayload(
              nonce, deviceAuth.deviceId,
              'operator', deviceAuth.scopes,
              signedAtMs, deviceAuth.deviceToken,
            );
            const signature = signPayload(deviceAuth.privateKeyPem, payload);

            params.auth = { deviceToken: deviceAuth.deviceToken };
            params.device = {
              id: deviceAuth.deviceId,
              publicKey: publicKeyRaw,
              signature,
              signedAt: signedAtMs,
              nonce,
            };
          } else {
            // Fallback to shared-secret token
            params.auth = { token };
          }

          ws.send(JSON.stringify({
            type: 'req',
            id,
            method: 'connect',
            params,
          }));

          pendingRequests.set(id, {
            resolve: (result) => {
              connected = true;
              log('Connected to Gateway (protocol %d, scopes: %s)',
                result?.protocol || 3, (result?.auth?.scopes || []).join(', '));
              if (connectResolve) connectResolve(result);
            },
            reject: (err) => {
              if (connectReject) connectReject(err);
            },
            method: 'connect',
          });
          return;
        }

        // Forward chat/agent events to message handler (for duplex mode)
        if (msg.event === 'chat' || msg.event === 'agent') {
          if (messageHandler) {
            messageHandler(msg);
          }
        }
        return;
      }

      // Response to RPC request
      if (msg.type === 'res' && pendingRequests.has(msg.id)) {
        const pending = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);

        if (msg.ok === false) {
          const err = new Error(msg.error?.message || JSON.stringify(msg.error));
          err.code = msg.error?.code;
          log.error('RPC error [%s]: %s', pending.method, err.message);
          pending.reject(err);
        } else {
          pending.resolve(msg.payload || msg.result || msg);
        }
      }
    } catch (err) {
      log.error('Parse error: %s', err.message);
    }
  });

  ws.on('open', () => log('WebSocket connected'));
  ws.on('close', (code, reason) => {
    connected = false;
    log('WebSocket closed (code: %d, reason: %s)', code, reason);
    for (const [id, pending] of pendingRequests) {
      pending.reject(new Error('WebSocket closed'));
    }
    pendingRequests.clear();
  });
  ws.on('error', (err) => {
    log.error('WebSocket error: %s', err.message);
    for (const [id, pending] of pendingRequests) {
      pending.reject(err);
    }
    pendingRequests.clear();
  });

  // RPC request helper
  function rpc(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!connected || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'));
        return;
      }
      const id = ++reqId + '-' + Date.now();
      pendingRequests.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`${method} timeout (${timeoutMs}ms)`));
        }
      }, timeoutMs);
    });
  }

  // Wait for connection handshake to complete
  const connectPromise = new Promise((resolve, reject) => {
    connectResolve = resolve;
    connectReject = reject;
    setTimeout(() => {
      if (!connected) {
        connectReject(new Error('Gateway connect handshake timeout (15s)'));
      }
    }, 15000);
  });

  /**
   * Wait for a run to complete while accumulating streamed text from agent events.
   */
  async function waitForRun(runId) {
    let accumulatedText = '';
    const streamHandler = (msg) => {
      if (msg.payload?.stream === 'assistant' && msg.payload?.data?.text) {
        const data = msg.payload.data;
        accumulatedText += data.delta || data.text;
      }
    };
    messageHandler = streamHandler;

    try {
      log('Waiting for run %s...', runId);
      const waitResult = await rpc('agent.wait', { runId }, 120000);
      if (accumulatedText) return accumulatedText.trim();
      if (waitResult?.payloads?.length > 0) {
        return waitResult.payloads[0].text || JSON.stringify(waitResult);
      }
      if (waitResult?.text) return waitResult.text;
      return JSON.stringify(waitResult);
    } finally {
      messageHandler = null;
    }
  }

  /**
   * Send a message to the AI agent via the Gateway.
   * Sends the message, then waits for the run to complete.
   */
  async function sendMessage(cfg, message) {
    if (!connected) await connectPromise;

    const result = await rpc('agent', {
      message,
      agentId: 'main',
      idempotencyKey: crypto.randomUUID(),
    }, 30000);

    if (result?.runId) {
      return await waitForRun(result.runId);
    }

    if (result?.payloads?.length > 0) {
      return result.payloads[0].text || JSON.stringify(result);
    }
    if (result?.text) return result.text;
    return JSON.stringify(result);
  }

  /**
   * Send a message via the connected WebSocket (for duplex mode).
   * Returns the run info; caller should subscribe to messageHandler for streaming text.
   */
  async function send(message) {
    if (!connected) await connectPromise;
    const result = await rpc('agent', {
      message,
      agentId: 'main',
      idempotencyKey: crypto.randomUUID(),
    }, 30000);

    if (result?.runId) {
      return await waitForRun(result.runId);
    }
    return result;
  }

  const onMessage = (handler) => { messageHandler = handler; };
  const close = () => {
    log('Closing WebSocket');
    ws.close();
  };

  return {
    ws,
    connectPromise,
    sendMessage: (cfg, msg) => sendMessage(cfg, msg),
    send,
    onMessage,
    close,
    get isConnected() { return connected; },
  };
}

/**
 * Legacy compatibility: send a message via a persistent connection if available,
 * otherwise opens a temporary connection.
 *
 * Modes should attach a reusable connection to `config._gwConn` (see createConnection).
 */
async function sendMessage(config, message) {
  // Reuse persistent connection if available
  if (config._gwConn) {
    return await config._gwConn.send(message);
  }
  // Fallback: temporary connection
  const conn = createConnection(config);
  try {
    await conn.connectPromise;
    return await conn.send(message);
  } finally {
    conn.close();
  }
}

module.exports = {
  sendMessage,
  createWsConnection: createConnection,
  createConnection,
  loadDeviceAuth,
};
