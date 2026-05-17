const blessed = require('blessed');

class TUI {
  constructor(config) {
    this.config = config;
    this.state = 'IDLE';
    this.mode = config.mode || 'vad';
    this.history = [];
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      autoPadding: false,
      dockBorders: true,
      mouse: true,
    });

    this._buildLayout();
    this._registerKeys();
  }

  _buildLayout() {
    const H = this.screen.height;
    const W = this.screen.width;

    const statusH = 1;
    const bottomH = 1;
    const avatarW = Math.max(14, Math.floor(W * 0.28));
    const historyW = W - avatarW;
    const contentH = H - statusH - bottomH;

    // Status bar
    this.topBar = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: statusH,
      tags: true,
      style: { fg: 'black', bg: 'white' },
      content: this._topBarContent(),
    });

    // Avatar panel
    this.avatarBox = blessed.box({
      top: statusH,
      left: 0,
      width: avatarW,
      height: '100%-1',
      tags: true,
      style: { fg: 'cyan', bg: 'black' },
      border: { type: 'line', fg: 'cyan' },
      label: '形象',
      content: this._avatarContent(),
    });

    // Conversation history
    this.historyBox = blessed.box({
      top: statusH,
      left: avatarW,
      width: historyW,
      height: '100%-1',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      style: { fg: 'white', bg: 'black' },
      border: { type: 'line', fg: 'gray' },
      label: '对话',
      content: '',
    });

    // Bottom bar — anchored to actual bottom of screen
    this.bottomBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: bottomH,
      tags: true,
      style: { fg: 'white', bg: 'black' },
      content: this._bottomBarContent(),
    });

    this.screen.append(this.topBar);
    this.screen.append(this.avatarBox);
    this.screen.append(this.historyBox);
    this.screen.append(this.bottomBar);
    this.screen.render();
  }

  _avatarContent() {
    const faces = {
      IDLE: '(o_o)',
      RECORDING: '(oOo)',
      THINKING: '(o_o)...',
      PROCESSING: '(-_-)',
      PLAYING: '(o^o)',
      ERROR: '(x_x)',
    };
    const face = faces[this.state] || '(o_o)';
    const labels = {
      IDLE: '就绪',
      RECORDING: '录音中',
      THINKING: '思考中',
      PROCESSING: '处理中',
      PLAYING: '播放中',
      ERROR: '出错了',
    };
    const label = labels[this.state] || '就绪';
    return `${face}\n${label}`;
  }

  _handleShortcut(action) {
    switch (action) {
      case 'exit':
        this.destroy();
        process.exit(0);
        break;
      case 'mode':
        if (this.onModeSwitch) {
          const modes = ['ptt', 'vad', 'duplex'];
          const idx = (modes.indexOf(this.mode) + 1) % modes.length;
          this.onModeSwitch(modes[idx]);
        }
        break;
      case 'clear':
        this.history = [];
        this.historyBox.setContent('');
        this.screen.render();
        break;
      case 'ptt':
        if (this.onEnter) this.onEnter();
        break;
      case 'mute':
        if (this.onMute) this.onMute();
        break;
    }
  }

  _registerKeys() {
    this.screen.key(['q', 'C-c'], () => { this.destroy(); process.exit(0); });
    this.screen.key(['m', 'M'], () => {
      if (this.onModeSwitch) {
        const modes = ['ptt', 'vad', 'duplex'];
        const idx = (modes.indexOf(this.mode) + 1) % modes.length;
        this.onModeSwitch(modes[idx]);
      }
    });
    this.screen.key('C-l', () => {
      this.history = [];
      this.historyBox.setContent('');
      this.screen.render();
    });
    this.screen.key(['s', 'S'], () => {
      if (this.mode === 'duplex' && this.onMute) this.onMute();
    });
    this.screen.key(['enter', 'return'], () => {
      if (this.mode === 'ptt' && this.onEnter) this.onEnter();
    });

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      const key = data.toString('utf-8');
      if (key === 'q' || key === '\x03') { this.destroy(); process.exit(0); return; }
      if (key === 'm' || key === 'M') {
        if (this.onModeSwitch) {
          const modes = ['ptt', 'vad', 'duplex'];
          const idx = (modes.indexOf(this.mode) + 1) % modes.length;
          this.onModeSwitch(modes[idx]);
        }
        return;
      }
      if (key === '\x0c') {
        this.history = [];
        this.historyBox.setContent('');
        this.screen.render();
        return;
      }
      if ((key === 's' || key === 'S') && this.mode === 'duplex' && this.onMute) {
        this.onMute(); return;
      }
      if ((key === '\r' || key === '\n') && this.mode === 'ptt' && this.onEnter) {
        this.onEnter(); return;
      }
    });
  }

  _topBarContent() {
    const modeLabels = { ptt: 'PTT', vad: 'VAD', duplex: 'DUPLEX' };
    const stateLabels = {
      IDLE: this.mode === 'ptt' ? '按Enter录音' : '请说话',
      RECORDING: '录音中',
      THINKING: '思考中',
      PROCESSING: '处理中',
      PLAYING: '播放中',
      ERROR: '错误',
    };
    const version = require('../package.json').version;
    return ` ZedVoice v${version} | ${modeLabels[this.mode]} | ${stateLabels[this.state] || '就绪'}`;
  }

  _bottomBarContent() {
    const hints = {
      ptt: 'Q退出  M模式  Enter录音',
      vad: 'Q退出  M模式  自动录音',
      duplex: 'Q退出  M模式  S静音  可打断',
    };
    return hints[this.mode] || 'Q退出  M模式';
  }

  // --- Public API ---

  render() { this.screen.render(); }

  destroy() {
    try { this.screen.destroy(); } catch {}
    process.stdout.write('\x1b[?25h\x1b[0m\x1b[2J\x1b[H');
  }

  setStatus(state) {
    this.state = state;
    this.topBar.setContent(this._topBarContent());
    this.avatarBox.setContent(this._avatarContent());
    this.screen.render();
  }

  setMode(mode) {
    this.mode = mode;
    this.topBar.setContent(this._topBarContent());
    this.bottomBar.setContent(this._bottomBarContent());
    this.screen.render();
  }

  updateAudioLevel(level) {
    if (this.state === 'RECORDING') {
      this.avatarBox.setContent(this._avatarContent());
      this.screen.render();
    }
  }

  setPlaybackProgress(pct) {
    const bar = '>'.repeat(Math.floor(pct / 5)) + '.'.repeat(20 - Math.floor(pct / 5));
    this.bottomBar.setContent(`播放 ${bar} ${Math.round(pct)}%`);
    this.screen.render();
  }

  addUserMessage(text) {
    this.history.push(`{green-fg}你:{/green-fg} ${text}`);
    this.historyBox.setContent(this.history.join('\n'));
    this.historyBox.scrollTo(this.historyBox.getScrollHeight(), 0);
    this.screen.render();
  }

  addAiMessage(text) {
    this.history.push(`{yellow-fg}Zed:{/yellow-fg} ${text}`);
    this.historyBox.setContent(this.history.join('\n'));
    this.historyBox.scrollTo(this.historyBox.getScrollHeight(), 0);
    this.screen.render();
  }

  setCurrentAction(text) {
    this.avatarBox.setContent(text);
    this.screen.render();
  }

  setError(text) {
    this.setStatus('ERROR');
    this.bottomBar.setContent(`错误: ${text}`);
    this.screen.render();
  }

  setHints(hints) {
    this.bottomBar.setContent(hints.join('  '));
    this.screen.render();
  }
}

module.exports = TUI;
